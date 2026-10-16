"""Escalation: DB-backed jobs polled by an asyncio loop. Survives restarts; never double-sends."""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update

from app.agents.police_agents import evaluate_addressed, police_status_agent
from app.agents.runner import AgentFailed, runner, wrap_data
from app.config import get_settings
from app.db import DispatchLog, EscalationJob, NewsAgency, PublicReport, SessionLocal, utcnow
from app.events import POLICE_STREAM, SYSTEM_STREAM, bus
from app.police import client as police_client

STREAMS = (SYSTEM_STREAM, POLICE_STREAM)
_wake = asyncio.Event()


def now() -> datetime:
    """Injected clock (tests patch this)."""
    return utcnow()


async def create_job(public_ref: str) -> datetime:
    due = now() + timedelta(seconds=get_settings().escalation_delay_seconds)
    async with SessionLocal() as db:
        existing = await db.scalar(select(EscalationJob).where(EscalationJob.public_ref == public_ref))
        if existing:
            return existing.due_at
        db.add(EscalationJob(public_ref=public_ref, due_at=due, state="pending"))
        await db.commit()
    wake()
    return due


def wake() -> None:
    _wake.set()


async def escalation_info(public_refs: list[str]) -> dict[str, dict[str, Any]]:
    if not public_refs:
        return {}
    async with SessionLocal() as db:
        jobs = (await db.scalars(select(EscalationJob).where(EscalationJob.public_ref.in_(public_refs)))).all()
        reports = (await db.scalars(select(PublicReport).where(PublicReport.public_ref.in_(public_refs)))).all()
        sent = (
            await db.scalars(
                select(DispatchLog.public_ref).where(
                    DispatchLog.public_ref.in_(public_refs),
                    DispatchLog.kind == "news_email",
                    DispatchLog.status.in_(("sent", "dry_run")),
                )
            )
        ).all()
    out: dict[str, dict[str, Any]] = {}
    rep = {r.public_ref: r for r in reports}
    for j in jobs:
        r = rep.get(j.public_ref)
        out[j.public_ref] = {
            "escalation_due_at": j.due_at.isoformat(),
            "escalation_state": j.state,
            "escalation_cancelled": bool(r and r.escalation_cancelled),
            "escalated_to_news": j.public_ref in set(sent),
            "escalation_result": json.loads(j.result_json) if j.result_json else None,
        }
    return out


async def cancel(public_ref: str) -> bool:
    async with SessionLocal() as db:
        r = await db.get(PublicReport, public_ref)
        if r is None:
            return False
        r.escalation_cancelled = True
        await db.execute(
            update(EscalationJob).where(EscalationJob.public_ref == public_ref, EscalationJob.state == "pending").values(state="cancelled")
        )
        await db.commit()
        session_id = r.session_id
    await bus.publish(session_id, "step", node="escalation_timer", data={"status": "skipped", "message": "News escalation cancelled by the survivor"}, also=STREAMS)
    return True


async def fast_forward(public_ref: str) -> bool:
    async with SessionLocal() as db:
        res = await db.execute(
            update(EscalationJob).where(EscalationJob.public_ref == public_ref, EscalationJob.state == "pending").values(due_at=now())
        )
        await db.commit()
    wake()
    return res.rowcount > 0


async def recover_running() -> None:
    """Jobs left 'running' by a crash go back to pending: every send is idempotent."""
    async with SessionLocal() as db:
        await db.execute(update(EscalationJob).where(EscalationJob.state == "running").values(state="pending"))
        await db.commit()


async def trigger_news(public_ref: str, session_id: str) -> dict[str, Any]:
    """Guarded, idempotent: re-checks cancellation, publication safety and police status."""
    from app.workflows.report import send_emails

    async with SessionLocal() as db:
        r = await db.get(PublicReport, public_ref)
        agencies = (await db.scalars(select(NewsAgency).where(NewsAgency.active.is_(True)))).all() if r else []
    if r is None:
        return {"triggered": False, "reason": "unknown public_ref"}
    if r.escalation_cancelled:
        return {"triggered": False, "reason": "escalation cancelled by survivor"}
    if not r.public_clean or not r.public_text:
        return {"triggered": False, "reason": "public description is on hold (privacy check)"}
    if not r.police_ref:
        return {"triggered": False, "reason": "no police reference"}
    status = (await police_client.status(r.police_ref))["status"]
    if evaluate_addressed(status):
        return {"triggered": False, "reason": f"complaint addressed ({status})"}
    recipients = [{"name": a.name, "email": a.email} for a in agencies if a.country.upper() == r.country.upper()]
    if not recipients:
        return {"triggered": False, "reason": f"no news agencies for {r.country}"}
    await bus.publish(session_id, "step", node="gmail_news", data={"status": "running", "message": f"Escalating {public_ref} to {len(recipients)} news agencies"}, also=STREAMS)
    work = {"public_ref": public_ref, "public_text": r.public_text, "police_ref": r.police_ref, "entities": []}
    results = await send_emails(session_id, "news", work, recipients, filed_on=r.created_at.strftime("%d %B %Y"))
    await bus.publish(session_id, "step", node="gmail_news", data={"status": "done", "results": results}, also=STREAMS)
    return {"triggered": True, "results": results}


async def run_job(job_id: int) -> dict[str, Any]:
    async with SessionLocal() as db:
        job = await db.get(EscalationJob, job_id)
        r = await db.get(PublicReport, job.public_ref) if job else None
    if job is None or r is None:
        return {"error": "job or report missing"}
    sid = r.session_id
    await bus.publish(sid, "step", node="escalation_timer", data={"status": "done", "message": f"Deadline reached for {r.public_ref}"}, also=STREAMS)
    if r.escalation_cancelled:
        return {"status": None, "addressed": None, "escalated": False, "reason": "cancelled"}

    triggered: dict[str, Any] = {}

    async def trigger(public_ref: str) -> dict:
        res = await trigger_news(public_ref, sid)
        triggered.update(res)
        return res

    state = {"police_ref": r.police_ref, "public_ref": r.public_ref, "trigger": trigger}
    await bus.publish(sid, "status", node="police_status_agent", data={"message": f"Police Status Agent checking {r.police_ref}…"}, also=STREAMS)
    decision: dict[str, Any] | None = None
    try:
        res = await runner.run(
            police_status_agent,
            session_id=sid,
            messages=f"Check this complaint.\n{wrap_data('data', f'police_ref: {r.police_ref}{chr(10)}public_ref: {r.public_ref}')}",
            state=state,
            also=STREAMS,
        )
        decision = res.output.model_dump()
    except AgentFailed:
        await bus.publish(sid, "step", node="police_status_agent", data={"fallback": True, "message": "Checking status directly"}, also=STREAMS)

    # The workflow, not the model, makes the final call.
    status = (await police_client.status(r.police_ref))["status"]
    addressed = evaluate_addressed(status)
    if not addressed and not triggered.get("triggered"):
        await trigger(r.public_ref)
    escalated = bool(triggered.get("triggered"))
    if escalated:
        reason = f"Complaint unaddressed after the deadline ({status}) → escalation triggered"
    elif addressed:
        reason = f"Addressed ({status}): no escalation"
    else:
        reason = triggered.get("reason") or "not escalated"
    result = {"status": status, "addressed": addressed, "escalated": escalated, "reason": reason, "agent_decision": decision}
    await bus.publish(sid, "status", node="police_status_agent", data={"message": f"{r.police_ref}: {reason}", **{k: v for k, v in result.items() if k != 'agent_decision'}}, also=STREAMS)
    if not escalated:
        await bus.publish(sid, "step", node="gmail_news", data={"status": "skipped", "message": reason}, also=STREAMS)
    return result


async def tick() -> int:
    """Run every due job once. Compare-and-set guarantees a single runner per job."""
    async with SessionLocal() as db:
        due = (
            await db.scalars(select(EscalationJob.id).where(EscalationJob.state == "pending", EscalationJob.due_at <= now()))
        ).all()
    ran = 0
    for job_id in due:
        async with SessionLocal() as db:
            res = await db.execute(
                update(EscalationJob).where(EscalationJob.id == job_id, EscalationJob.state == "pending").values(state="running")
            )
            await db.commit()
        if res.rowcount != 1:
            continue
        ran += 1
        try:
            result = await run_job(job_id)
            final_state = "done"
        except Exception as e:  # noqa: BLE001
            result = {"error": f"{type(e).__name__}: {e}"}
            final_state = "pending"  # retried next tick; sends are idempotent
            await bus.publish(SYSTEM_STREAM, "error", node="police_status_agent", data={"message": f"Escalation job {job_id} failed: {e}"}, also=(POLICE_STREAM,))
        async with SessionLocal() as db:
            job = await db.get(EscalationJob, job_id)
            job.state = final_state
            job.result_json = json.dumps(result, default=str)
            if final_state == "pending":
                job.due_at = now() + timedelta(seconds=60)
            await db.commit()
    return ran


async def scheduler_loop(stop: asyncio.Event) -> None:
    global _wake
    _wake = asyncio.Event()
    await recover_running()
    await bus.publish(SYSTEM_STREAM, "status", node="escalation_timer", data={"message": "Scheduler started"})
    while not stop.is_set():
        _wake.clear()
        try:
            await tick()
        except Exception as e:  # noqa: BLE001
            await bus.publish(SYSTEM_STREAM, "error", node="escalation_timer", data={"message": f"Scheduler error: {e}"})
        try:
            await asyncio.wait_for(_wake.wait(), timeout=get_settings().scheduler_poll_s)
        except TimeoutError:
            pass
