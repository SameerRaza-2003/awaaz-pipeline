from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app import sessions
from app.api.sse import event_stream, parse_last_id
from app.config import normalize_recipient
from app.events import bus
from app.outbound import is_valid_recipient
from app.workflows import emergency

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0)


class CreateSession(BaseModel):
    locale: str = "en"
    country: str | None = None


class TrustedContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    phone: str = Field(min_length=6, max_length=24)


class SettingsIn(BaseModel):
    trusted_contact: TrustedContactIn | None = None
    country: str | None = Field(default=None, max_length=10)
    locale: str | None = Field(default=None, max_length=10)


class DangerIn(BaseModel):
    answer: Literal["yes", "no"]
    location: Location | None = None
    location_text: str | None = Field(default=None, max_length=300)


async def require_session(session_id: str):
    row = await sessions.get_session(session_id)
    if row is None:
        raise HTTPException(404, "session not found")
    return row


@router.post("")
async def create_session(body: CreateSession | None = None):
    body = body or CreateSession()
    row = await sessions.create_session(body.locale, body.country)
    return {"session_id": row.id, "country": row.country, "locale": row.locale}


@router.get("/{session_id}")
async def get_session(session_id: str):
    row = await require_session(session_id)
    contact = await sessions.get_trusted_contact(session_id)
    state = await sessions.load_state(session_id)
    return {
        "session_id": row.id,
        "phase": row.phase,
        "country": row.country,
        "locale": row.locale,
        "trusted_contact": {"name": contact[0], "phone": contact[1]} if contact else None,
        "transcript": state.get("transcript", []),
        "drafts": state.get("drafts"),
        "receipt": state.get("receipt"),
    }


@router.put("/{session_id}/settings")
async def put_settings(session_id: str, body: SettingsIn):
    await require_session(session_id)
    if body.trusted_contact:
        phone = normalize_recipient(body.trusted_contact.phone)
        if not is_valid_recipient("sms", phone):
            raise HTTPException(422, "phone must be in international format, e.g. +923001234567")
        await sessions.set_trusted_contact(session_id, body.trusted_contact.name.strip(), phone)
    await sessions.update_settings(session_id, country=body.country, locale=body.locale)
    return {"ok": True}


@router.get("/{session_id}/events")
async def events(session_id: str, request: Request, last_id: int | None = Query(default=None)):
    await require_session(session_id)
    return event_stream(request, [session_id], parse_last_id(request, last_id))


@router.post("/{session_id}/danger")
async def danger(session_id: str, body: DangerIn):
    await require_session(session_id)
    if body.answer == "yes":
        loc = body.location.model_dump() if body.location else None
        em_id = await emergency.start(session_id, loc, body.location_text)
        return {"emergency_id": em_id, "status": "started"}
    await sessions.set_phase(session_id, "ask_report")
    await bus.publish(session_id, "step", node="danger_gate", data={"status": "done", "answer": "no"})
    return {"status": "ask_report"}


@router.post("/{session_id}/location")
async def location(session_id: str, body: Location):
    await require_session(session_id)
    return await emergency.tracking_update(session_id, body.lat, body.lng, body.accuracy)


@router.post("/{session_id}/safe")
async def safe(session_id: str):
    await require_session(session_id)
    return await emergency.mark_safe(session_id)
