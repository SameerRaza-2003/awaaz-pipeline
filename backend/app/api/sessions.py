import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app import accounts, sessions
from app.api.accounts import optional_user
from app.api.sse import event_stream, parse_last_id
from app.config import get_settings, normalize_phone, normalize_recipient
from app.events import bus
from app.agents.emergency_agents import send_discord
from app.outbound import discord_recipient, is_valid_recipient
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
    phone: str | None = Field(default=None, max_length=24)
    discord_webhook: str | None = Field(default=None, max_length=300)


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
async def create_session(body: CreateSession | None = None, user_id: str | None = Depends(optional_user)):
    body = body or CreateSession()
    locale, country = body.locale, body.country
    if user_id:
        profile = accounts.profile_of(await accounts.get_user(user_id))
        locale = profile.get("locale") or locale
        country = country or profile.get("country")
    row = await sessions.create_session(locale, country, user_id=user_id)
    return {"session_id": row.id, "country": row.country, "locale": row.locale}


def trusted_contact_view(contact, discord) -> dict | None:
    """The session's contact, or the operator's defaults from .env (so one-tap calling works in demos too)."""
    if contact:
        return {"name": contact[0], "phone": contact[1], "has_discord": bool(discord)}
    default_phone = normalize_recipient(get_settings().default_trusted_contact) if get_settings().default_trusted_contact else None
    if default_phone or discord:
        return {"name": "your trusted contact", "phone": default_phone, "has_discord": bool(discord), "is_default": True}
    return None


@router.get("/{session_id}")
async def get_session(session_id: str):
    row = await require_session(session_id)
    contact = await sessions.get_trusted_contact(session_id)
    discord = await sessions.get_contact_discord(session_id)
    state = await sessions.load_state(session_id)
    return {
        "session_id": row.id,
        "phase": row.phase,
        "country": row.country,
        "locale": row.locale,
        "trusted_contact": trusted_contact_view(contact, discord),
        "signed_in": bool(row.user_id),
        "transcript": state.get("transcript", []),
        "drafts": state.get("drafts"),
        "receipt": state.get("receipt"),
    }


@router.put("/{session_id}/settings")
async def put_settings(session_id: str, body: SettingsIn):
    await require_session(session_id)
    if body.trusted_contact:
        tc = body.trusted_contact
        sess = await sessions.get_session(session_id)
        phone = None
        if tc.phone and tc.phone.strip():
            phone = normalize_phone(tc.phone, body.country or (sess.country if sess else None))
            if not phone:
                raise HTTPException(422, "Enter a valid phone number with its country code, e.g. +44 7700 900123")
        webhook = (tc.discord_webhook or "").strip() or None
        if webhook and not discord_recipient(webhook):
            raise HTTPException(422, "Discord webhook must look like https://discord.com/api/webhooks/<id>/<token>")
        if not phone and not webhook:
            raise HTTPException(422, "add a phone number or a Discord webhook for your trusted contact")
        if webhook is None and tc.discord_webhook is None:
            webhook = await sessions.get_own_discord(session_id)  # keep her own saved one; never copy fallbacks in
        await sessions.set_trusted_contact(session_id, tc.name.strip(), phone, webhook)
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


@router.post("/{session_id}/discord-test")
async def discord_test(session_id: str):
    """Lets the survivor check the webhook before an emergency. Goes through the outbound guard like everything else."""
    await require_session(session_id)
    url = await sessions.get_contact_discord(session_id)
    if not url:
        raise HTTPException(404, "no Discord webhook saved")
    res = await send_discord(
        session_id, f"test:{secrets.token_hex(4)}", url,
        "Awaaz test message: this channel will receive emergency alerts from someone who trusts you. No action needed.",
        agent="setup", node="alert_agent",
    )
    return res.as_dict()
