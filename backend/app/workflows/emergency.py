"""Emergency workflow (deterministic). Fail open: if agents fail, a fixed template calls the same tools."""

import asyncio
from datetime import timedelta
from typing import Any

from sqlalchemy import select

from app.agents.emergency_agents import ensure_link, location_agent, send_discord, alert_agent
from app.agents.runner import AgentFailed, runner, wrap_data
from app.agents.schemas import AlertResult, LocationReport
from app.config import get_settings, normalize_recipient
from app.db import DispatchLog, Emergency, SessionLocal, utcnow
from app.events import bus
from app.outbound import guard
from app.outbound import discord_recipient
from app.sessions import get_contact_discord, get_trusted_contact, set_phase
from app.tools import maps

_tasks: set[asyncio.Task] = set()


def spawn(coro) -> asyncio.Task:
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)
    return t


async def _active_emergency(session_id: str) -> Emergency | None:
    async with SessionLocal() as db:
        return await db.scalar(
            select(Emergency)
            .where(Emergency.session_id == session_id, Emergency.ended_at.is_(None))
            .order_by(Emergency.id.desc())
            .limit(1)
        )


async def record_location(session_id: str, lat: float, lng: float, accuracy: float | None) -> Emergency | None:
    async with SessionLocal() as db:
        em = await db.scalar(
            select(Emergency)
            .where(Emergency.session_id == session_id, Emergency.ended_at.is_(None))
            .order_by(Emergency.id.desc())
            .limit(1)
        )
        if em is None:
            return None
        em.last_lat, em.last_lng, em.last_accuracy = lat, lng, accuracy
        em.last_location_at = utcnow()
        await db.commit()
        return em


async def resolve_recipients(session_id: str) -> tuple[str | None, str | None, list[str]]:
    """(contact name, call recipient, sms recipients). Decided in code, never by the LLM."""
    s = get_settings()
    contact = await get_trusted_contact(session_id)
    name, phone = (contact if contact else ("your trusted contact", s.default_trusted_contact or None))
    sms: list[str] = []
    if phone:
        sms.append(normalize_recipient(phone))
    if s.alert_authorities and s.authority_number:
        sms.append(normalize_recipient(s.authority_number))
    return name, (normalize_recipient(phone) if phone else None), sms


async def start(session_id: str, location: dict | None, note: str | None) -> int:
    async with SessionLocal() as db:
        em = Emergency(session_id=session_id, location_note=note)
        if location:
            em.last_lat, em.last_lng = location["lat"], location["lng"]
            em.last_accuracy = location.get("accuracy")
            em.last_location_at = utcnow()
        db.add(em)
        await db.commit()
        await db.refresh(em)
    await set_phase(session_id, "emergency")
    await bus.publish(session_id, "workflow.start", node="danger_gate", data={"workflow": "emergency", "emergency_id": em.id})
    await bus.publish(session_id, "step", node="danger_gate", data={"status": "done", "answer": "yes"})
    spawn(run(session_id, em.id))
    return em.id


async def deterministic_location(session_id: str) -> LocationReport:
    loc = await maps.get_latest_location(session_id)
    if not loc["location_available"]:
        return LocationReport(location_available=False, note=loc.get("note"))
    geo = await maps.reverse_geocode(loc["lat"], loc["lng"])
    return LocationReport(
        location_available=True,
        lat=loc["lat"],
        lng=loc["lng"],
        accuracy_m=loc.get("accuracy_m"),
        address=geo.get("address"),
        address_source=geo.get("source"),
        maps_link=maps.build_maps_link(loc["lat"], loc["lng"]),
        captured_at=loc.get("captured_at"),
        note=loc.get("note"),
    )


def template_sms(name: str, report: LocationReport) -> str:
    if report.location_available:
        where = report.address or f"{report.lat:.5f}, {report.lng:.5f}"
        return (
            f"URGENT from Awaaz: the person who listed you ({name}) as a trusted contact says they may be in danger "
            f"and need help now. Location: {where} {report.maps_link} (updated {_hhmm(report.captured_at)} UTC). "
            "Please call them or go to them."
        )
    typed = f" They said they are near: {report.note}." if report.note else ""
    return (
        f"URGENT from Awaaz: the person who listed you ({name}) as a trusted contact says they may be in danger "
        f"and need help now. Their live location is unavailable.{typed} Please call them now."
    )


def template_call(report: LocationReport) -> str:
    where = f"near {report.address}" if report.address else "at the location sent to you by text message"
    if not report.location_available:
        where = "but their location is not available"
    return (
        "This is an urgent call from Awaaz. Someone who listed you as a trusted contact says they may be in danger "
        f"and need help now, {where}. Please check your text messages and contact them immediately."
    )


def _hhmm(iso: str | None) -> str:
    return iso[11:16] if iso and len(iso) >= 16 else "just now"


def _validated_report(agent_report: LocationReport, truth: LocationReport) -> LocationReport:
    """The agent may phrase things, but coordinates and link must match what the browser sent."""
    if not truth.location_available:
        return truth
    if not agent_report.location_available or agent_report.lat is None or agent_report.lng is None:
        return truth
    if abs(agent_report.lat - truth.lat) > 1e-4 or abs(agent_report.lng - truth.lng) > 1e-4:  # type: ignore[operator]
        return truth
    # Keep the tool's address: it carries the source needed for attribution.
    return truth.model_copy(update={"address": truth.address or agent_report.address})


async def run(session_id: str, emergency_id: int) -> dict[str, Any]:
    s = get_settings()
    name, call_to, sms_to = await resolve_recipients(session_id)
    discord_url = await get_contact_discord(session_id)
    if not call_to and not discord_url:
        await bus.publish(
            session_id,
            "error",
            node="alert_agent",
            data={"message": "No trusted contact is set up yet, so no one could be alerted. Add one in Setup.", "warning": True},
        )
    elif not call_to:
        await bus.publish(session_id, "status", node="alert_agent",
                          data={"message": "No phone number for your trusted contact: alerting by Discord only.", "warning": True})
    elif not await get_trusted_contact(session_id):
        await bus.publish(
            session_id,
            "status",
            node="alert_agent",
            data={"message": "Alerting the default emergency contact. Add your own trusted contact in Setup.", "warning": True},
        )

    # 1. Location
    truth = await deterministic_location_safe(session_id)
    try:
        res = await runner.run(
            location_agent,
            session_id=session_id,
            messages="Prepare the location report for this emergency now.",
        )
        report = _validated_report(res.output, truth)
    except AgentFailed:
        await bus.publish(session_id, "step", node="location_agent", data={"fallback": True, "message": "Location Agent failed; using deterministic location report"})
        report = truth
    await bus.publish(session_id, "status", node="location_agent", data={"location": report.model_dump(mode="json")})

    # 2. Alert + call
    key = f"em{emergency_id}:alert"
    sent: AlertResult | None = None
    if call_to or discord_url:
        state = {
            "report": report.model_dump(mode="json"),
            "sms_recipients": sms_to,
            "call_recipient": call_to or "",
            "dispatch_key": key,
            "discord_url": discord_url,
        }
        prompt = wrap_data(
            "data",
            f"contact_name: {name}\nsms_recipients: {sms_to}\ncall_recipient: {call_to or 'none'}\n"
            f"discord_available: {bool(discord_url)}\nlocation_report: {report.model_dump_json()}",
        )
        try:
            res = await runner.run(
                alert_agent,
                session_id=session_id,
                messages=f"Send the emergency alert and place the call.\n{prompt}",
                state=state,
            )
            sent = res.output
        except AgentFailed:
            await bus.publish(session_id, "step", node="alert_agent", data={"fallback": True, "message": "Alert Agent failed; sending with the fixed template"})
        await ensure_alert_sent(session_id, key, name or "trusted contact", report, sms_to, call_to, discord_url)

    async with SessionLocal() as db:
        em = await db.get(Emergency, emergency_id)
        if em:
            em.last_update_sent_at = utcnow()
            await db.commit()
        rows = (await db.scalars(select(DispatchLog).where(DispatchLog.public_ref == key))).all()
    result = {
        "location": report.model_dump(mode="json"),
        "dispatch": [{"kind": r.kind, "to": r.recipient, "status": r.status, "sid": r.provider_id} for r in rows],
        "agent_result": sent.model_dump(mode="json") if sent else None,
    }
    await bus.publish(session_id, "workflow.end", node="alert_agent", data={"workflow": "emergency", **result})
    return result


async def deterministic_location_safe(session_id: str) -> LocationReport:
    try:
        return await deterministic_location(session_id)
    except Exception:  # noqa: BLE001
        return LocationReport(location_available=False)


async def ensure_alert_sent(session_id, key, name, report, sms_to, call_to, discord_url=None) -> None:
    """Check dispatch_log and fill every gap with the fixed template. Idempotent by construction."""
    async with SessionLocal() as db:
        rows = (await db.scalars(select(DispatchLog).where(DispatchLog.public_ref == key))).all()
    done = {(r.kind, r.recipient) for r in rows if r.status in ("sent", "dry_run", "blocked", "skipped", "pending")}
    body = template_sms(name, report)
    for to in sms_to:
        if ("sms", to) not in done:
            await bus.publish(session_id, "step", node="alert_agent", data={"fallback": True, "message": f"Fallback SMS to {to}"})
            await guard.dispatch(kind="sms", key=key, recipient=to, session_id=session_id,
                                 payload={"body": ensure_link(body, report.model_dump())}, agent="fallback", node="alert_agent")
    if discord_url and ("discord", discord_recipient(discord_url)) not in done:
        await bus.publish(session_id, "step", node="alert_agent", data={"fallback": True, "message": "Fallback Discord alert"})
        await send_discord(session_id, key, discord_url, ensure_link(body, report.model_dump()), agent="fallback", node="alert_agent")
    if call_to and ("call", call_to) not in done:
        await bus.publish(session_id, "step", node="alert_agent", data={"fallback": True, "message": f"Fallback call to {call_to}"})
        await guard.dispatch(kind="call", key=key, recipient=call_to, session_id=session_id,
                             payload={"say_text": template_call(report)}, agent="fallback", node="alert_agent")


# ---------------- Tracking (tool-only, no LLM) ----------------

async def tracking_update(session_id: str, lat: float, lng: float, accuracy: float | None) -> dict:
    s = get_settings()
    em = await record_location(session_id, lat, lng, accuracy)
    if em is None:
        return {"tracking": False, "reason": "no active emergency"}
    now = utcnow()
    if em.updates_sent >= s.tracking_max_updates:
        return {"tracking": True, "sent": False, "reason": "max updates reached"}
    if em.last_update_sent_at and now - em.last_update_sent_at < timedelta(seconds=s.tracking_interval_s):
        return {"tracking": True, "sent": False, "reason": "throttled"}
    _, _, sms_to = await resolve_recipients(session_id)
    n = em.updates_sent + 1
    async with SessionLocal() as db:
        row = await db.get(Emergency, em.id)
        row.updates_sent = n
        row.last_update_sent_at = now
        await db.commit()
    link = maps.build_maps_link(lat, lng)
    body = f"Awaaz location update {n}: {link} (updated {now.strftime('%H:%M')} UTC)"
    await bus.publish(session_id, "tool.start", agent="tracking_updater", node="alert_agent",
                      data={"tool": "send_sms", "args": {"update": n, "maps_link": link}})
    for to in sms_to:
        await guard.dispatch(kind="sms", key=f"em{em.id}:update{n}", recipient=to, session_id=session_id,
                             payload={"body": body}, agent="tracking_updater", node="alert_agent")
    if discord_url := await get_contact_discord(session_id):
        await send_discord(session_id, f"em{em.id}:update{n}", discord_url, body, agent="tracking_updater", node="alert_agent")
    await bus.publish(session_id, "tool.end", agent="tracking_updater", node="alert_agent",
                      data={"tool": "send_sms", "result": {"update": n, "recipients": len(sms_to)}})
    return {"tracking": True, "sent": True, "update": n}


async def mark_safe(session_id: str) -> dict:
    em = await _active_emergency(session_id)
    if em is None:
        return {"ok": False, "reason": "no active emergency"}
    async with SessionLocal() as db:
        row = await db.get(Emergency, em.id)
        row.ended_at = utcnow()
        await db.commit()
    _, _, sms_to = await resolve_recipients(session_id)
    safe_text = "Awaaz: the person who sent you the emergency alert has marked themselves SAFE. Location tracking has stopped."
    for to in sms_to:
        await guard.dispatch(kind="sms", key=f"em{em.id}:safe", recipient=to, session_id=session_id,
                             payload={"body": safe_text}, agent="tracking_updater", node="alert_agent")
    if discord_url := await get_contact_discord(session_id):
        await send_discord(session_id, f"em{em.id}:safe", discord_url, safe_text, agent="tracking_updater", node="alert_agent")
    await set_phase(session_id, "safe")
    await bus.publish(session_id, "status", node="alert_agent", data={"message": "Marked safe. Tracking stopped.", "safe": True})
    return {"ok": True}
