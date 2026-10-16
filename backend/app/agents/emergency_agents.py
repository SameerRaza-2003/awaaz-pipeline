"""Location Agent and Twilio Agent."""

from pydantic import BaseModel, Field

from app.agents.runner import AgentSpec, RunContext, make_tool
from app.agents.schemas import AlertResult, LocationReport
from app.config import normalize_recipient
from app.outbound import delivery_status, guard
from app.tools import maps


class NoArgs(BaseModel):
    pass


class LatLng(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


# ---------------- Location Agent ----------------

LOCATION_PROMPT = """You are the Location Agent of Awaaz, an emergency helper for harassment survivors.
Your job: produce an accurate, shareable location report for an emergency alert.

Steps:
1. Call get_latest_location to read the most recent coordinates the survivor's browser sent.
2. If a location is available, call reverse_geocode with those exact coordinates, then build_maps_link with them.
3. Return the LocationReport. Copy lat, lng, accuracy_m and captured_at exactly from get_latest_location,
   the address from reverse_geocode (null if none), and maps_link exactly from build_maps_link.
4. If no location is available, return location_available=false and put any typed location text in note.
Be fast: this is an emergency. Do not invent coordinates or addresses."""


async def _get_latest_location(ctx: RunContext) -> dict:
    return await maps.get_latest_location(ctx.session_id)


async def _reverse_geocode(ctx: RunContext, lat: float, lng: float) -> dict:
    return await maps.reverse_geocode(lat, lng)


async def _build_maps_link(ctx: RunContext, lat: float, lng: float) -> dict:
    return {"maps_link": maps.build_maps_link(lat, lng)}


def _location_tools(ctx: RunContext):
    return [
        make_tool(ctx, "get_latest_location", "Most recent browser coordinates for this session, with accuracy and timestamp.", NoArgs, _get_latest_location),
        make_tool(ctx, "reverse_geocode", "Street address for coordinates (Google Geocoding). May return coordinates only.", LatLng, _reverse_geocode),
        make_tool(ctx, "build_maps_link", "Google Maps link for coordinates.", LatLng, _build_maps_link),
    ]


location_agent = AgentSpec(
    name="location_agent",
    system_prompt=LOCATION_PROMPT,
    build_tools=_location_tools,
    output_schema=LocationReport,
)


# ---------------- Twilio Agent ----------------

TWILIO_PROMPT = """You are the Twilio Agent of Awaaz. A harassment survivor pressed "I am in danger".
You alert her trusted contact by SMS and phone call.

You receive the location report and the recipients inside <data> tags.
1. Write a calm, short SMS (under 300 characters) to the trusted contact: say the survivor may be in danger
   and needs help now, include the Google Maps link (or say the location is unavailable and give any typed
   location), and the last-updated time. Call send_sms once for each recipient listed under sms_recipients.
2. Write a short spoken script (2-3 sentences, simple words, no URLs) and call place_call to the call_recipient.
3. Optionally call get_delivery_status for the returned sids.
4. Return AlertResult with the sids and statuses the tools returned. Never invent sids.
Only the listed recipients can be contacted; the tools reject anyone else."""


class SmsArgs(BaseModel):
    to: str = Field(description="E.164 phone number from sms_recipients")
    body: str = Field(min_length=10, max_length=600)


class CallArgs(BaseModel):
    to: str
    say_text: str = Field(min_length=10, max_length=600)


class SidArgs(BaseModel):
    sid: str


def ensure_link(body: str, report: dict) -> str:
    link = report.get("maps_link")
    if link and link not in body:
        body = f"{body.rstrip()} {link}"
    return body


async def _send_sms(ctx: RunContext, to: str, body: str) -> dict:
    allowed = {normalize_recipient(x) for x in ctx.state["sms_recipients"]}
    to_n = normalize_recipient(to)
    if to_n not in allowed:
        return {"status": "rejected", "error": "recipient is not one of the allowed sms_recipients"}
    body = ensure_link(body, ctx.state["report"])
    res = await guard.dispatch(
        kind="sms",
        key=ctx.state["dispatch_key"],
        recipient=to_n,
        session_id=ctx.session_id,
        payload={"body": body},
        agent=ctx.agent,
        node=ctx.node,
        run_id=ctx.run_id,
    )
    return {"to": res.to, "sid": res.provider_id, "status": res.status, "error": res.error}


async def _place_call(ctx: RunContext, to: str, say_text: str) -> dict:
    to_n = normalize_recipient(to)
    if to_n != normalize_recipient(ctx.state["call_recipient"]):
        return {"status": "rejected", "error": "only the trusted contact can be called"}
    res = await guard.dispatch(
        kind="call",
        key=ctx.state["dispatch_key"],
        recipient=to_n,
        session_id=ctx.session_id,
        payload={"say_text": say_text},
        agent=ctx.agent,
        node=ctx.node,
        run_id=ctx.run_id,
    )
    return {"to": res.to, "sid": res.provider_id, "status": res.status, "error": res.error}


async def _get_delivery_status(ctx: RunContext, sid: str) -> dict:
    return {"sid": sid, "status": await delivery_status(sid)}


def _twilio_tools(ctx: RunContext):
    return [
        make_tool(ctx, "send_sms", "Send one SMS to one allowed recipient.", SmsArgs, _send_sms),
        make_tool(ctx, "place_call", "Call the trusted contact; say_text is read aloud twice, slowly.", CallArgs, _place_call),
        make_tool(ctx, "get_delivery_status", "Delivery status for an SMS or call sid.", SidArgs, _get_delivery_status),
    ]


twilio_agent = AgentSpec(
    name="twilio_agent",
    system_prompt=TWILIO_PROMPT,
    build_tools=_twilio_tools,
    output_schema=AlertResult,
)
