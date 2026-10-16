"""LLM privacy layer on top of the deterministic scanner.

1. extract_identifiers: reads the whole case and lists every detail that could identify someone
   (names, plates, handles, workplaces, unusual details). These become known entities for the scanner,
   so the scanner, not the model, enforces them.
2. review_public_text: an independent second read of a public text. It can only make the check stricter:
   a text is public-clean only if the scanner AND this review pass. If the review cannot run, it fails closed.
"""

import asyncio
import contextvars
import json
import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.agents.runner import DATA_GUARD, wrap_data
from app.config import get_settings
from app.events import bus
from app.llm import get_chat_model
from app.tools.pii import Entity, ScanResult, scan

NODE = "drafting_agent"
AGENT = "privacy_guard"


class Identifier(BaseModel):
    value: str = Field(description="exact text as it appears in the case, e.g. a name, plate number, handle, company")
    kind: Literal["person", "org", "address", "contact", "identifier"]


class Identifiers(BaseModel):
    items: list[Identifier] = Field(default_factory=list)


class Review(BaseModel):
    identifying_details: list[str] = Field(
        default_factory=list, description="every detail in the text that could identify the survivor, the accused or a witness"
    )
    clean: bool = Field(description="true only if identifying_details is empty")


EXTRACT_PROMPT = """You protect harassment survivors' privacy. From the case below, list EVERY detail that could identify
a real person if published: personal names (also partial names and nicknames, in any script), phone numbers, emails,
social-media handles, ID/CNIC numbers, vehicle registration or plate numbers, house/street addresses, names of companies,
schools, shops or other organisations, job titles that are rare enough to identify someone, and any other unique detail.
Copy each value exactly as written. Only list NAMED or SPECIFIC things: "Zenith Textiles" yes, "the university" or "an office"
no. Never list cities, provinces, countries, dates, generic places or roles like "manager" or "a student": the public text is
allowed to say the city and to describe places generically.
""" + DATA_GUARD

REVIEW_PROMPT = """You are a strict privacy reviewer for a public post about a harassment case. List every detail in the text that
could identify the survivor, the accused or a witness: names or initials, numbers (phone, ID, plate, room), handles,
specific organisation names, street-level locations, rare job titles, or unique events. City-level places, dates,
generic roles ("a senior colleague", "a private company in Lahore") and neutral descriptions of conduct are fine.
Saying that evidence exists ("she noted the plate number", "she has screenshots") is fine; only the actual values
(the number itself, the account name) are identifying. Set clean=true only if there is nothing identifying.
""" + DATA_GUARD


def enabled() -> bool:
    return get_settings().privacy_llm_review


async def _structured(schema: type[BaseModel], system: str, user: str, timeout: float) -> BaseModel:
    model = get_chat_model(AGENT).with_structured_output(schema, method="function_calling")
    # Fresh context: when called from inside an agent's tool, do not inherit that agent's callbacks.
    task = asyncio.create_task(model.ainvoke([("system", system), ("user", user)]), context=contextvars.Context())
    return await asyncio.wait_for(task, timeout=timeout)


async def _emit(session_id: str, kind: str, run_id: str, data: dict[str, Any]) -> None:
    await bus.publish(session_id, kind, agent=AGENT, node=NODE, run_id=run_id, data=data)


async def extract_identifiers(session_id: str, record: dict[str, Any], transcript_text: str = "") -> list[dict[str, str]]:
    """Best effort: on failure the scanner still has the slot entities and its pattern rules."""
    if not enabled():
        return []
    run_id = f"r_{uuid.uuid4().hex[:10]}"
    t0 = time.perf_counter()
    await _emit(session_id, "tool.start", run_id, {"tool": "extract_identifiers", "args": {"fields": sorted(record)}})
    try:
        payload = json.dumps(record, ensure_ascii=False) + ("\n" + transcript_text if transcript_text else "")
        res = await _structured(Identifiers, EXTRACT_PROMPT, wrap_data("data", payload), get_settings().agent_timeout_s)
        # City-level location is allowed in public text, so the case's own city/area/country never become blockers.
        allowed = " ".join(str(record.get(k) or "") for k in ("city_area", "country")).lower()
        items = []
        for i in res.items:  # type: ignore[attr-defined]
            v = (i.value or "").strip()
            if not v or (v.lower() in allowed and i.kind != "address"):
                continue
            items.append({"value": v, "kind": "contact" if i.kind == "address" else i.kind})
        await _emit(session_id, "tool.end", run_id, {"tool": "extract_identifiers", "result": {"count": len(items), "kinds": sorted({i["kind"] for i in items})},
                                                      "duration_ms": int((time.perf_counter() - t0) * 1000)})
        return items
    except Exception as e:  # noqa: BLE001
        await _emit(session_id, "tool.end", run_id, {"tool": "extract_identifiers", "error": f"{type(e).__name__}: {e}"})
        return []


async def review_public_text(session_id: str, text: str) -> dict[str, Any]:
    """Fails closed: if the review cannot run, the text is not confirmed clean."""
    if not enabled():
        return {"clean": True, "skipped": True}
    run_id = f"r_{uuid.uuid4().hex[:10]}"
    t0 = time.perf_counter()
    await _emit(session_id, "tool.start", run_id, {"tool": "review_public_text", "args": {"chars": len(text)}})
    try:
        res = await _structured(Review, REVIEW_PROMPT, wrap_data("public_text", text), get_settings().agent_timeout_s)
        details = [d for d in res.identifying_details if d.strip()]  # type: ignore[attr-defined]
        out = {"clean": bool(res.clean) and not details, "identifying_details": details}  # type: ignore[attr-defined]
    except Exception as e:  # noqa: BLE001
        out = {"clean": False, "error": f"privacy review unavailable: {type(e).__name__}"}
    await _emit(session_id, "tool.end", run_id, {"tool": "review_public_text", "result": out, "duration_ms": int((time.perf_counter() - t0) * 1000)})
    return out


async def full_check(session_id: str, text: str, entities: list[Any]) -> ScanResult:
    """Scanner first (cheap, deterministic); the LLM review only runs on text the scanner already passed."""
    ents = [Entity(**e) if isinstance(e, dict) else e for e in entities]
    res = scan(text, ents)
    if not res.clean:
        return res
    review = await review_public_text(session_id, text)
    if review["clean"]:
        return res
    findings = [{"type": "privacy_review", "match": d} for d in review.get("identifying_details", [])]
    if review.get("error"):
        findings.append({"type": "privacy_review", "match": review["error"]})
    return ScanResult(clean=False, findings=findings)
