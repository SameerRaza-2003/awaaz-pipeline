from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.sessions import require_session
from app.api.sse import event_stream, parse_last_id
from app.config import get_settings
from app.db import Community, NewsAgency, SessionLocal
from app.events import SYSTEM_STREAM
from app.workflows import escalation, report

router = APIRouter(prefix="/api", tags=["report"])


class StartIn(BaseModel):
    wants_report: bool


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class ReviseIn(BaseModel):
    target: Literal["public", "police"]
    instruction: str = Field(min_length=2, max_length=1000)


class ConfirmIn(BaseModel):
    police_text: str | None = Field(default=None, max_length=20000)
    public_text: str | None = Field(default=None, max_length=5000)


def _flow(e: report.FlowError) -> HTTPException:
    return HTTPException(e.status, e.message)


@router.post("/sessions/{session_id}/report/start")
async def start(session_id: str, body: StartIn):
    await require_session(session_id)
    return await report.start(session_id, body.wants_report)


@router.post("/sessions/{session_id}/messages")
async def message(session_id: str, body: MessageIn):
    await require_session(session_id)
    try:
        return await report.message(session_id, body.text)
    except report.FlowError as e:
        raise _flow(e) from e


@router.post("/sessions/{session_id}/report/revise")
async def revise(session_id: str, body: ReviseIn):
    await require_session(session_id)
    try:
        await report.revise(session_id, body.target, body.instruction)
    except report.FlowError as e:
        raise _flow(e) from e
    return {"status": "drafting"}


@router.post("/sessions/{session_id}/report/confirm")
async def confirm(session_id: str, body: ConfirmIn):
    await require_session(session_id)
    try:
        return await report.confirm(session_id, body.police_text, body.public_text)
    except report.FlowError as e:
        raise _flow(e) from e


@router.post("/complaints/{public_ref}/cancel-escalation")
async def cancel_escalation(public_ref: str):
    if not await escalation.cancel(public_ref):
        raise HTTPException(404, "unknown reference")
    return {"cancelled": True}


@router.get("/communities")
async def communities():
    async with SessionLocal() as db:
        rows = (await db.scalars(select(Community).where(Community.active.is_(True)).order_by(Community.name))).all()
    return [{"name": r.name, "countries": r.countries} for r in rows]


@router.get("/news-agencies")
async def news_agencies():
    async with SessionLocal() as db:
        rows = (await db.scalars(select(NewsAgency).where(NewsAgency.active.is_(True)).order_by(NewsAgency.name))).all()
    return [{"name": r.name, "country": r.country} for r in rows]


@router.get("/system/events")
async def system_events(request: Request, last_id: int | None = None):
    return event_stream(request, [SYSTEM_STREAM], parse_last_id(request, last_id))


def demo_router() -> APIRouter:
    demo = APIRouter(prefix="/api/demo", tags=["demo"])

    @demo.post("/fast-forward/{public_ref}")
    async def fast_forward(public_ref: str):
        if not get_settings().enable_demo_routes:
            raise HTTPException(404)
        ok = await escalation.fast_forward(public_ref)
        if not ok:
            raise HTTPException(404, "no pending escalation for this reference")
        return {"ok": True}

    @demo.post("/reset")
    async def reset():
        if not get_settings().enable_demo_routes:
            raise HTTPException(404)
        from app.demo import reset_all

        return await reset_all()

    return demo
