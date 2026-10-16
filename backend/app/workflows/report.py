"""Report workflow (deterministic): intake -> drafting -> survivor review -> police + communities in parallel."""

import asyncio
import json
import secrets
from collections import defaultdict
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from sqlalchemy import select

from app.agents.drafting import drafting_agent
from app.agents.gmail import gmail_agent, template_email
from app.agents.intake import MAX_TURNS, build_record, fallback_turn, intake_agent, looks_like_danger
from app.agents.matching import matching_agent
from app.agents.police_agents import police_dispatch_agent, submit_complaint
from app.agents.runner import AgentFailed, runner, wrap_data
from app.config import get_settings, normalize_recipient
from app.db import DispatchLog, PublicReport, SessionLocal
from app.events import bus
from app.outbound import guard
from app.sessions import get_session, load_state, purge_state, save_state, set_phase
from app.tools import similarity
from app.tools.pii import entities_from_record, scan
from app.workflows import escalation
from app.workflows.emergency import spawn

_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

GREETING = {
    "en": "Thank you for trusting us. I'm here to listen, and you can skip any question. "
    "Whenever you're ready, could you tell me in your own words what happened?",
    "ur": "ہم پر بھروسہ کرنے کا شکریہ۔ میں سن رہی ہوں، آپ کوئی بھی سوال چھوڑ سکتی ہیں۔ "
    "جب آپ تیار ہوں، کیا آپ اپنے الفاظ میں بتا سکتی ہیں کہ کیا ہوا؟",
}

CLOSING = (
    "Thank you. You are not alone, and you can come back any time. If you ever feel unsafe, press "
    "\"Yes\" on the danger question to alert your trusted contact. Pakistan: Police 15, Rescue 1122, "
    "Ministry of Human Rights helpline 1099, Madadgaar helpline 1098."
)


class FlowError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def new_public_ref() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "AWZ-" + "".join(secrets.choice(alphabet) for _ in range(8))


async def start(session_id: str, wants_report: bool) -> dict[str, Any]:
    sess = await get_session(session_id)
    if not wants_report:
        await set_phase(session_id, "closed")
        await bus.publish(session_id, "status", node="danger_gate", data={"message": "No report requested", "closing": CLOSING})
        return {"phase": "closed", "message": CLOSING}
    async with _locks[session_id]:
        state = await load_state(session_id)
        if state.get("transcript"):
            return {"phase": sess.phase, "message": state["transcript"][-1]["text"]}
        greeting = GREETING.get(sess.locale if sess else "en", GREETING["en"])
        state = {
            "transcript": [{"role": "assistant", "text": greeting}],
            "slots": {"country": sess.country if sess else get_settings().default_country},
            "turns": 0,
            "default_country": sess.country if sess else get_settings().default_country,
        }
        await save_state(session_id, state)
        await set_phase(session_id, "intake")
    await bus.publish(session_id, "workflow.start", node="intake_agent", data={"workflow": "report"})
    await bus.publish(session_id, "step", node="intake_agent", data={"status": "waiting", "message": "Interview started"})
    return {"phase": "intake", "message": greeting}


def _history(transcript: list[dict], note: str | None) -> list[BaseMessage]:
    msgs: list[BaseMessage] = []
    for i, m in enumerate(transcript):
        if m["role"] == "user":
            content = wrap_data("survivor_message", m["text"])
            if note and i == len(transcript) - 1:
                content += f"\n\n[App note: {note}]"
            msgs.append(HumanMessage(content=content))
        else:
            msgs.append(AIMessage(content=m["text"]))
    if msgs and isinstance(msgs[0], AIMessage):
        msgs.insert(0, HumanMessage(content="[App note: the survivor chose to report a case. You greeted her.]"))
    return msgs


async def message(session_id: str, text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        raise FlowError(422, "empty message")
    async with _locks[session_id]:
        sess = await get_session(session_id)
        if sess is None or sess.phase != "intake":
            raise FlowError(409, f"not in intake (phase={sess.phase if sess else None})")
        state = await load_state(session_id)
        state.setdefault("transcript", []).append({"role": "user", "text": text})
        state["turns"] = state.get("turns", 0) + 1
        danger = looks_like_danger(text)
        if danger:
            await bus.publish(session_id, "status", node="intake_agent", data={"danger_suspected": True, "message": "Possible danger detected"})
        note = None
        if state["turns"] >= MAX_TURNS:
            note = "turn limit reached: call finalize_intake now with what exists, then tell her drafts are being prepared."
        reply = None
        try:
            if state.get("fallback_q") is not None:
                raise AgentFailed("deterministic interview already in progress")
            res = await runner.run(intake_agent, session_id=session_id, messages=_history(state["transcript"], note), state=state)
            for m in reversed(res.messages):
                if isinstance(m, AIMessage) and not m.tool_calls and m.content:
                    reply = m.content if isinstance(m.content, str) else str(m.content)
                    break
        except AgentFailed:
            if not state.get("final"):
                reply = fallback_turn(state, text, sess.locale)
                if reply is None:
                    state["record"] = build_record(state.get("slots", {}), state.get("default_country", "PK")).model_dump()
                    state["final"] = True
                await bus.publish(session_id, "step", node="intake_agent", data={"fallback": True, "message": "Intake Agent unavailable; asking fixed questions"})
        if not state.get("final") and state["turns"] >= MAX_TURNS + 2 and state.get("fallback_q") is None:
            # Deterministic stop: move on with what exists.
            state["record"] = build_record(state.get("slots", {}), state.get("default_country", "PK")).model_dump()
            state["final"] = True
            await bus.publish(session_id, "step", node="intake_agent", data={"message": "Turn limit reached; intake finalized by the app"})
        if not reply:
            reply = (
                "Thank you. I'm preparing two drafts for you to review now."
                if state.get("final")
                else "I'm sorry, I had trouble understanding that. Could you tell me again, in any words you like?"
            )
        state["transcript"].append({"role": "assistant", "text": reply})
        danger = danger or bool(state.pop("danger", False))
        finalized = bool(state.get("final"))
        await save_state(session_id, state)
        if finalized:
            await set_phase(session_id, "drafting")
            await bus.publish(session_id, "step", node="intake_agent", data={"status": "done", "message": "Intake complete"})
            spawn(run_drafting(session_id))
    return {"reply": reply, "finalized": finalized, "danger_suspected": danger}


def police_template(rec: dict[str, Any]) -> str:
    lines = ["COMPLAINT STATEMENT (prepared from the complainant's account)", ""]
    labels = [
        ("complainant_name", "Complainant"), ("complainant_contact", "Contact"), ("complainant_address", "Address"),
        ("date_time", "Date/time of incident"), ("city_area", "Location"), ("country", "Country"),
        ("harassment_type", "Type of harassment"), ("institution_involved", "Institution"), ("accused", "Accused"),
        ("witnesses", "Witnesses"), ("evidence_available", "Evidence available"), ("prior_reports", "Prior reports"),
    ]
    for k, label in labels:
        if rec.get(k):
            lines.append(f"{label}: {rec[k]}")
    lines += ["", "Account:", rec.get("incident_summary") or "Not provided"]
    return "\n".join(lines)


async def run_drafting(session_id: str, instruction: str | None = None, target: str | None = None) -> dict[str, Any]:
    async with _locks[session_id]:
        state = await load_state(session_id)
    record = state.get("record") or build_record(state.get("slots", {}), state.get("default_country", "PK")).model_dump()
    slots = {**state.get("slots", {}), **record}
    ents = [{"value": e.value, "kind": e.kind} for e in entities_from_record(slots)]
    previous = state.get("drafts")
    work: dict[str, Any] = {"entities": ents}
    if previous and target == "public":
        work["lock_police"] = previous["police_text"]  # survivor's police text stays as is
    data = f"case_record: {json.dumps(record, ensure_ascii=False)}"
    if previous and instruction:
        data += f"\ncurrent_police_text: {previous['police_text']}\ncurrent_public_text: {previous['public_text']}"
        data += f"\nrevision_target: {target}\nsurvivor_revision_request: {instruction}"
    ask = "Write both drafts." if not instruction else f"Revise the {target} draft as the survivor requested; keep the other unchanged."
    await bus.publish(session_id, "step", node="drafting_agent", data={"status": "running", "revision": bool(instruction)})
    try:
        await runner.run(drafting_agent, session_id=session_id, messages=f"{ask}\n{wrap_data('data', data)}", state=work)
    except AgentFailed:
        pass
    drafts = work.get("drafts")
    if drafts is None:
        police_text = previous["police_text"] if previous else police_template(record)
        drafts = {"police_text": police_text, "public_text": previous["public_text"] if previous else "", "public_clean": bool(previous and previous.get("public_clean")), "pii_findings": []}
        await bus.publish(session_id, "step", node="drafting_agent", data={"fallback": True, "message": "Drafting Agent failed; police text built from the record"})
    if target == "police" and previous:
        # A police-only revision never changes the approved public text.
        drafts["public_text"], drafts["public_clean"], drafts["pii_findings"] = previous["public_text"], previous.get("public_clean", False), previous.get("pii_findings", [])
    # Final deterministic gate on the public text.
    check = scan(drafts["public_text"], ents) if drafts["public_text"] else None
    drafts["public_clean"] = bool(check and check.clean)
    drafts["pii_findings"] = check.findings if check else []
    async with _locks[session_id]:
        state = await load_state(session_id)
        state["drafts"] = drafts
        state["record"] = record
        await save_state(session_id, state)
        await set_phase(session_id, "review")
    await bus.publish(
        session_id,
        "status",
        node="drafting_agent",
        data={
            "drafts_ready": True,
            "public_clean": drafts["public_clean"],
            "public_on_hold": not drafts["public_clean"],
            "pii_findings": [{"type": f["type"]} for f in drafts["pii_findings"]],
        },
    )
    await bus.publish(session_id, "step", node="user_review", data={"status": "waiting", "message": "Waiting for the survivor to review and press Send"})
    return drafts


async def revise(session_id: str, target: str, instruction: str) -> None:
    sess = await get_session(session_id)
    if sess is None or sess.phase != "review":
        raise FlowError(409, "drafts are not ready for review")
    await set_phase(session_id, "drafting")
    spawn(run_drafting(session_id, instruction=instruction, target=target))


async def confirm(session_id: str, police_text: str | None, public_text: str | None) -> dict[str, Any]:
    async with _locks[session_id]:
        sess = await get_session(session_id)
        if sess is None or sess.phase != "review":
            raise FlowError(409, "nothing to confirm")
        state = await load_state(session_id)
        drafts = state.get("drafts")
        if not drafts:
            raise FlowError(409, "no drafts")
        record = state["record"]
        slots = {**state.get("slots", {}), **record}
        ents = [{"value": e.value, "kind": e.kind} for e in entities_from_record(slots)]
        final_police = (police_text or drafts["police_text"]).strip()
        final_public = (public_text if public_text is not None else drafts["public_text"]).strip()
        check = scan(final_public, ents) if final_public else None
        public_clean = bool(check and check.clean)
        if public_text is not None and public_text.strip() != drafts["public_text"].strip() and not public_clean:
            raise FlowError(422, "Your edited public text contains personal information: " + ", ".join(sorted({f["type"] for f in check.findings})) if check else "empty public text")
        public_ref = new_public_ref()
        country = record.get("country") or sess.country
        async with SessionLocal() as db:
            db.add(PublicReport(public_ref=public_ref, session_id=session_id, country=country,
                                public_text=final_public if public_clean else "", public_clean=public_clean))
            await db.commit()
        await set_phase(session_id, "sending")
    await bus.publish(session_id, "step", node="user_review", data={"status": "done", "public_ref": public_ref, "public_clean": public_clean})
    work = {
        "public_ref": public_ref,
        "police_text": final_police,
        "public_text": final_public if public_clean else "",
        "public_clean": public_clean,
        "record": record,
        "country": country,
        "entities": ents,
    }
    spawn(dispatch_all(session_id, work))
    return {"public_ref": public_ref, "public_clean": public_clean}


async def dispatch_all(session_id: str, work: dict[str, Any]) -> dict[str, Any]:
    receipt: dict[str, Any] = {"public_ref": work["public_ref"], "public_clean": work["public_clean"]}
    try:
        police_res, community_res = await asyncio.gather(
            police_branch(session_id, work), community_branch(session_id, work), return_exceptions=True
        )
        if isinstance(police_res, BaseException):
            await bus.publish(session_id, "error", node="police_dispatch_agent", data={"message": f"Police submission failed: {police_res}"})
            police_res = {"police_submitted": False}
        if isinstance(community_res, BaseException):
            await bus.publish(session_id, "error", node="gmail_communities", data={"message": f"Community outreach failed: {community_res}"})
            community_res = {"communities": []}
        receipt.update(police_res)
        receipt.update(community_res)
        receipt.pop("police_ref", None)  # the survivor receipt never needs the police reference
        await bus.publish(session_id, "workflow.end", node="gmail_communities", data={"workflow": "report", "receipt": receipt})
    finally:
        await finish_session(session_id, receipt)
    return receipt


async def police_branch(session_id: str, work: dict[str, Any]) -> dict[str, Any]:
    state = {k: work[k] for k in ("public_ref", "police_text", "record", "country")}
    data = wrap_data("data", f"city: {work['record'].get('city_area')}\ncountry: {work['country']}\nharassment_type: {work['record'].get('harassment_type')}")
    try:
        await runner.run(police_dispatch_agent, session_id=session_id, messages=f"Submit this complaint.\n{data}", state=state)
    except AgentFailed:
        await bus.publish(session_id, "step", node="police_dispatch_agent", data={"fallback": True, "message": "Submitting directly"})
    if not state.get("police_ref"):
        await submit_complaint(state)  # deterministic fallback, idempotent on public_ref
    async with SessionLocal() as db:
        row = await db.get(PublicReport, work["public_ref"])
        row.police_ref = state["police_ref"]
        await db.commit()
    due = None
    if work["public_clean"]:
        due = await escalation.create_job(work["public_ref"])
        await bus.publish(session_id, "step", node="escalation_timer", data={"status": "waiting", "due_at": due.isoformat(), "public_ref": work["public_ref"]})
    else:
        await bus.publish(session_id, "step", node="escalation_timer", data={"status": "skipped", "message": "Public report on hold: no news escalation"})
    return {"police_submitted": True, "submitted_at": state.get("submitted_at"), "escalation_due_at": due.isoformat() if due else None}


async def community_branch(session_id: str, work: dict[str, Any]) -> dict[str, Any]:
    if not work["public_clean"]:
        msg = "Public report on hold: the privacy check could not confirm it is free of personal information. Nothing was sent to communities."
        for node in ("matching_agent", "gmail_communities"):
            await bus.publish(session_id, "step", node=node, data={"status": "skipped", "message": msg})
        return {"communities": [], "public_on_hold": True}

    m_state = {"public_text": work["public_text"], "country": work["country"]}
    reasons: dict[int, str] = {}
    try:
        res = await runner.run(
            matching_agent,
            session_id=session_id,
            messages=f"Match this case.\n{wrap_data('data', 'country: ' + work['country'] + chr(10) + 'public_text: ' + work['public_text'])}",
            state=m_state,
        )
        reasons = {r.community_id: r.reason for r in res.output.recipients}
    except AgentFailed:
        await bus.publish(session_id, "step", node="matching_agent", data={"fallback": True, "message": "Matching directly by similarity"})
    if "selected" not in m_state:
        m_state["scores"] = await similarity.score_communities(work["public_text"], work["country"])
        m_state["selected"] = similarity.select_recipients(m_state["scores"])
    selected = [
        {**c, "reason": reasons.get(c["community_id"]) or f"Similarity {c['score']:.2f} to the community's focus"}
        for c in m_state["selected"]
    ]
    await bus.publish(
        session_id,
        "status",
        node="matching_agent",
        data={
            "threshold": similarity.effective_threshold(m_state.get("scores", [])),
            "scores": [{"name": c["name"], "score": c["score"]} for c in m_state.get("scores", [])],
            "selected": [{"name": c["name"], "score": c["score"], "reason": c["reason"]} for c in selected],
        },
    )
    if not selected:
        await bus.publish(session_id, "step", node="gmail_communities", data={"status": "skipped", "message": "No community matched"})
        return {"communities": [], "no_match": True}

    results = await send_emails(session_id, "communities", work, [{"name": c["name"], "email": c["email"]} for c in selected])
    by_email = {r["to"]: r for r in results}
    return {
        "communities": [
            {"name": c["name"], "score": c["score"], "reason": c["reason"], "status": by_email.get(normalize_recipient(c["email"]), {}).get("status", "unknown")}
            for c in selected
        ]
    }


async def send_emails(session_id: str, mode: str, work: dict[str, Any], recipients: list[dict], filed_on: str | None = None) -> list[dict]:
    """Gmail Agent, then a deterministic gap-filler so every approved recipient gets exactly one email."""
    state = {
        "mode": mode,
        "public_ref": work["public_ref"],
        "public_text": work["public_text"],
        "entities": work.get("entities", []),
        "recipients": recipients,
        "police_ref": work.get("police_ref"),
        "reply_to": get_settings().email_reply_to or get_settings().smtp_user or "reply@awaaz.example",
    }
    lines = "\n".join(f"- {r['name']} <{r['email']}>" for r in recipients)
    data = f"public_ref: {work['public_ref']}\nrecipients:\n{lines}\npublic_description:\n{work['public_text']}"
    if filed_on:
        data += f"\nfiled_on: {filed_on}"
    spec = gmail_agent(mode)
    try:
        await runner.run(spec, session_id=session_id, messages=f"Send the {mode} emails.\n{wrap_data('data', data)}", state=state,
                         also=(("system",) if mode == "news" else ()),
                         timeout_s=max(get_settings().agent_timeout_s, 30.0 * len(recipients)))
    except AgentFailed:
        await bus.publish(session_id, "step", node=spec.node, data={"fallback": True, "message": "Sending with the fixed template"})
    kind = "community_email" if mode == "communities" else "news_email"
    async with SessionLocal() as db:
        rows = (await db.scalars(select(DispatchLog).where(DispatchLog.public_ref == work["public_ref"], DispatchLog.kind == kind))).all()
    done = {r.recipient for r in rows if r.status in ("sent", "dry_run", "blocked", "pending")}
    subject, body = template_email(mode, work["public_ref"], work["public_text"], filed_on)
    for r in recipients:
        to = normalize_recipient(r["email"])
        if to not in done:
            await guard.dispatch(kind=kind, key=work["public_ref"], recipient=to, session_id=session_id,
                                 payload={"subject": subject, "body": body}, agent="fallback", node=spec.node)
    async with SessionLocal() as db:
        rows = (await db.scalars(select(DispatchLog).where(DispatchLog.public_ref == work["public_ref"], DispatchLog.kind == kind))).all()
    return [{"to": r.recipient, "status": r.status, "message_id": r.provider_id} for r in rows]


async def finish_session(session_id: str, receipt: dict[str, Any]) -> None:
    await set_phase(session_id, "sent")
    if get_settings().purge_transcript:
        await purge_state(session_id, keep={"receipt": receipt})
        await bus.redact_session(session_id, ("intake_agent", "drafting_agent", "police_dispatch_agent"))
        await bus.publish(session_id, "status", node="user_review", data={"message": "Transcript purged from this device's session", "purged": True})
    else:
        state = await load_state(session_id)
        state["receipt"] = receipt
        await save_state(session_id, state)
    await bus.publish(session_id, "status", node="gmail_communities", data={"receipt": receipt})
