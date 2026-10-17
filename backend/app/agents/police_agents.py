"""Police Dispatch Agent and Police Status Agent."""

from collections.abc import Awaitable, Callable

from pydantic import BaseModel

from app.agents.runner import AgentSpec, RunContext, make_tool
from app.agents.schemas import HARASSMENT_TYPES, DispatchOut, StatusDecision
from app.config import get_settings
from app.police import client as police_client

# ---------------- Police Dispatch ----------------

DISPATCH_PROMPT = """You are the Police Dispatch Agent of Awaaz. You submit a survivor's full complaint to the police dashboard.
1. Call get_public_ref.
2. Call submit_to_police_dashboard with the case city, country and harassment type from the data.
   The tool attaches the survivor-approved police description and complainant details itself.
3. Return DispatchOut with police_ref, public_ref and submitted_at exactly as the tools returned them."""


class NoArgs(BaseModel):
    pass


class SubmitArgs(BaseModel):
    city: str | None = None
    country: str
    harassment_type: str


async def _get_public_ref(ctx: RunContext) -> dict:
    return {"public_ref": ctx.state["public_ref"]}


async def submit_complaint(state: dict, city: str | None = None, harassment_type: str | None = None) -> dict:
    if state.get("police_ref"):
        return {"police_ref": state["police_ref"], "public_ref": state["public_ref"], "submitted_at": state["submitted_at"], "duplicate": True}
    rec = state["record"]
    ht = harassment_type if harassment_type in HARASSMENT_TYPES else rec.get("harassment_type")
    if ht != rec.get("harassment_type"):
        ht = rec.get("harassment_type")  # the record wins over the model
    complaint = {
        "public_ref": state["public_ref"],
        "full_text": state["police_text"],
        "complainant_name": rec.get("complainant_name"),
        "complainant_contact": rec.get("complainant_contact"),
        "complainant_address": rec.get("complainant_address"),
        "accused": rec.get("accused"),
        "country": rec.get("country") or state.get("country"),
        "city": rec.get("city_area") or city,
        "harassment_type": ht,
    }
    res = await police_client.submit(complaint)
    state["police_ref"] = res["police_ref"]
    state["submitted_at"] = res["received_at"]
    return {"police_ref": res["police_ref"], "public_ref": state["public_ref"], "submitted_at": res["received_at"]}


async def _submit(ctx: RunContext, country: str, harassment_type: str, city: str | None = None) -> dict:
    return await submit_complaint(ctx.state, city, harassment_type)


def _dispatch_tools(ctx: RunContext):
    return [
        make_tool(ctx, "get_public_ref", "The random public reference for this case.", NoArgs, _get_public_ref),
        make_tool(ctx, "submit_to_police_dashboard", "Submit the full complaint to the police system; returns police_ref.", SubmitArgs, _submit),
    ]


police_dispatch_agent = AgentSpec(
    name="police_dispatch_agent", system_prompt=DISPATCH_PROMPT, build_tools=_dispatch_tools, output_schema=DispatchOut
)

# ---------------- Police Status ----------------

STATUS_PROMPT = """You are the Police Status Agent of Awaaz. The waiting period for a complaint has passed.
1. Call get_complaint_status with the police_ref.
2. Call evaluate_addressed with the status you got.
3. ONLY if evaluate_addressed says addressed=false, call trigger_news_escalation with the public_ref.
4. Return StatusDecision {status, addressed, escalated, reason} with a one-sentence reason that says "the authorities", never "the police"."""


class RefArgs(BaseModel):
    police_ref: str


class StatusArgs(BaseModel):
    status: str


class PublicRefArgs(BaseModel):
    public_ref: str


def evaluate_addressed(status: str) -> bool:
    return status.strip().upper() in get_settings().addressed_set


async def _get_status(ctx: RunContext, police_ref: str) -> dict:
    if police_ref != ctx.state["police_ref"]:
        return {"error": "unknown police_ref for this job"}
    res = await police_client.status(police_ref)
    ctx.state["status"] = res["status"]
    return res


async def _evaluate(ctx: RunContext, status: str) -> dict:
    # Evaluate the status the tool actually fetched, not what the model typed.
    real = ctx.state.get("status") or status
    addressed = evaluate_addressed(real)
    return {"status": real, "addressed": addressed, "addressed_statuses": sorted(get_settings().addressed_set)}


async def _trigger(ctx: RunContext, public_ref: str) -> dict:
    if public_ref != ctx.state["public_ref"]:
        return {"triggered": False, "reason": "unknown public_ref"}
    trigger: Callable[[str], Awaitable[dict]] = ctx.state["trigger"]
    return await trigger(public_ref)


def _status_tools(ctx: RunContext):
    return [
        make_tool(ctx, "get_complaint_status", "Current police status and last update.", RefArgs, _get_status),
        make_tool(ctx, "evaluate_addressed", "Deterministic rule: is this status 'addressed'?", StatusArgs, _evaluate),
        make_tool(ctx, "trigger_news_escalation", "Start the news escalation (re-checks status and cancellation).", PublicRefArgs, _trigger),
    ]


police_status_agent = AgentSpec(
    name="police_status_agent", system_prompt=STATUS_PROMPT, build_tools=_status_tools, output_schema=StatusDecision
)
