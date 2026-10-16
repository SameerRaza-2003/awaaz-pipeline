import asyncio
import json
from datetime import timedelta

import httpx
from sqlalchemy import select

from app import sessions
from app.config import get_settings
from app.db import DispatchLog, EscalationJob, SessionLocal, utcnow
from app.events import bus
from app.main import create_app
from app.police import service
from app.workflows import escalation, report

from .helpers import Scripts, drain, final, tool_call
from .test_report import _to_review


async def _submitted_case(monkeypatch, s: Scripts) -> str:
    sid = await _to_review(monkeypatch, s)
    res = await report.confirm(sid, None, None)
    await drain()
    return res["public_ref"]


async def _news(public_ref):
    async with SessionLocal() as db:
        return (await db.scalars(select(DispatchLog).where(DispatchLog.public_ref == public_ref, DispatchLog.kind == "news_email"))).all()


async def _police_ref(public_ref):
    for c in await service.list_complaints():
        if c.public_ref == public_ref:
            return c.police_ref


def _clock(monkeypatch, hours: float):
    monkeypatch.setattr(escalation, "now", lambda: utcnow() + timedelta(hours=hours))


async def test_not_due_yet_does_nothing(monkeypatch):
    s = Scripts().install()
    ref = await _submitted_case(monkeypatch, s)
    assert await escalation.tick() == 0
    _clock(monkeypatch, 23.9)
    assert await escalation.tick() == 0
    assert await _news(ref) == []


async def test_new_complaint_escalates_once(monkeypatch):
    s = Scripts().install()
    ref = await _submitted_case(monkeypatch, s)
    pref = await _police_ref(ref)
    s.add("police_status_agent", tool_call("get_complaint_status", police_ref=pref), tool_call("evaluate_addressed", status="NEW"),
          tool_call("trigger_news_escalation", public_ref=ref), final("StatusDecision", status="NEW", addressed=False, escalated=True, reason="x"))
    _clock(monkeypatch, 24.1)
    assert await escalation.tick() == 1
    news = await _news(ref)
    assert len(news) == 3 and all(n.status == "dry_run" for n in news)  # one per agency in PK
    # running again never sends twice
    async with SessionLocal() as db:
        job = await db.scalar(select(EscalationJob).where(EscalationJob.public_ref == ref))
        job.state = "pending"
        await db.commit()
    assert await escalation.tick() == 1
    assert len(await _news(ref)) == 3
    assert (await escalation.trigger_news(ref, "s"))["triggered"] is True
    assert len(await _news(ref)) == 3
    hist = await bus.history("police")
    assert any("escalation triggered" in (e["data"].get("message") or "") for e in hist)


async def test_agent_skipping_trigger_is_overruled(monkeypatch):
    s = Scripts().install()
    ref = await _submitted_case(monkeypatch, s)
    pref = await _police_ref(ref)
    # the model wrongly claims "addressed" and never triggers: the workflow escalates anyway
    s.add("police_status_agent", tool_call("get_complaint_status", police_ref=pref),
          final("StatusDecision", status="NEW", addressed=True, escalated=False, reason="looks fine"))
    _clock(monkeypatch, 25)
    await escalation.tick()
    assert len(await _news(ref)) == 3


async def test_in_progress_does_not_escalate(monkeypatch):
    s = Scripts().install()
    ref = await _submitted_case(monkeypatch, s)
    pref = await _police_ref(ref)
    await service.update_status(pref, "IN_PROGRESS", "investigating", "officer")
    # the model wrongly tries to escalate: the guard refuses
    s.add("police_status_agent", tool_call("trigger_news_escalation", public_ref=ref),
          final("StatusDecision", status="IN_PROGRESS", addressed=False, escalated=True, reason="x"))
    _clock(monkeypatch, 30)
    await escalation.tick()
    assert await _news(ref) == []


async def test_acknowledged_alone_still_escalates(monkeypatch):
    s = Scripts().install()
    ref = await _submitted_case(monkeypatch, s)
    await service.update_status(await _police_ref(ref), "ACKNOWLEDGED", None, "officer")
    _clock(monkeypatch, 30)
    await escalation.tick()  # agent has no script -> fails -> deterministic path
    assert len(await _news(ref)) == 3


async def test_cancel_prevents_escalation(monkeypatch):
    s = Scripts().install()
    ref = await _submitted_case(monkeypatch, s)
    assert await escalation.cancel(ref)
    _clock(monkeypatch, 30)
    assert await escalation.tick() == 0
    assert await _news(ref) == []
    assert (await escalation.trigger_news(ref, "s"))["triggered"] is False


async def test_restart_mid_wait_still_escalates(monkeypatch):
    s = Scripts().install()
    ref = await _submitted_case(monkeypatch, s)
    # simulate a crash while the job was running
    async with SessionLocal() as db:
        job = await db.scalar(select(EscalationJob).where(EscalationJob.public_ref == ref))
        job.state = "running"
        await db.commit()
    from app import db as dbmod
    from app.police import db as pdb

    await dbmod.close_db()
    await pdb.close_police_db()
    await dbmod.init_db()
    await pdb.init_police_db()
    await escalation.recover_running()
    _clock(monkeypatch, 24.5)
    assert await escalation.tick() == 1
    assert len(await _news(ref)) == 3


async def test_scheduler_loop_and_fast_forward(monkeypatch):
    s = Scripts().install()
    ref = await _submitted_case(monkeypatch, s)
    stop = asyncio.Event()
    task = asyncio.create_task(escalation.scheduler_loop(stop))
    await asyncio.sleep(0.05)
    assert await escalation.fast_forward(ref)
    for _ in range(100):
        if await _news(ref):
            break
        await asyncio.sleep(0.05)
    stop.set()
    escalation.wake()
    await asyncio.wait_for(task, 5)
    assert len(await _news(ref)) == 3


async def test_police_api(monkeypatch):
    s = Scripts().install()
    ref = await _submitted_case(monkeypatch, s)
    app = create_app(with_lifespan=False)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.get("/api/police/complaints")).status_code == 401
        bad = await c.post("/api/police/login", json={"username": "officer", "password": "nope"})
        assert bad.status_code == 401
        tok = (await c.post("/api/police/login", json={"username": "officer", "password": "awaaz-demo"})).json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        lst = (await c.get("/api/police/complaints", headers=h)).json()["complaints"]
        assert lst[0]["public_ref"] == ref and lst[0]["escalation_state"] == "pending"
        pref = lst[0]["police_ref"]
        d = (await c.get(f"/api/police/complaints/{pref}", headers=h)).json()
        assert d["complainant_name"] == "Ayesha Siddiqui" and "Bilal" in d["full_text"]
        r = await c.patch(f"/api/police/complaints/{pref}/status", headers=h, json={"status": "RESOLVED", "note": "done"})
        assert r.json()["status"] == "RESOLVED"
        assert (await c.patch(f"/api/police/complaints/{pref}/status", headers=h, json={"status": "BOGUS"})).status_code == 422
        # intake requires the service key
        assert (await c.post("/api/police/intake", json={})).status_code == 401
        assert (await c.post(f"/api/demo/fast-forward/{ref}")).json()["ok"]
        health = (await c.get("/healthz")).json()
        assert health["outbound_mode"] == "dry_run"


async def test_sse_replay_after_reconnect():
    from app.api.sse import event_stream

    sid = (await sessions.create_session()).id
    for i in range(3):
        await bus.publish(sid, "status", data={"i": i})

    class FakeRequest:
        headers: dict = {}

        async def is_disconnected(self):
            return False

    async def first_n(last_id, n):
        resp = event_stream(FakeRequest(), [sid], last_id)
        out = []
        gen = resp.body_iterator
        async for item in gen:
            if item.get("event") == "message":
                out.append(json.loads(item["data"]))
            if len(out) >= n:
                break
        await gen.aclose()
        return out

    all3 = await first_n(None, 3)
    assert [e["data"]["i"] for e in all3] == [0, 1, 2]
    after = await first_n(all3[0]["id"], 2)
    assert [e["data"]["i"] for e in after] == [1, 2]

    async def later():
        await asyncio.sleep(0.05)
        await bus.publish(sid, "status", data={"i": 3})

    asyncio.create_task(later())
    live = await asyncio.wait_for(first_n(all3[-1]["id"], 1), 3)
    assert live[0]["data"]["i"] == 3


async def test_dry_run_never_touches_network(monkeypatch):
    # conftest replaces the provider factories with ones that raise; a full flow must not hit them
    s = Scripts().install()
    ref = await _submitted_case(monkeypatch, s)
    _clock(monkeypatch, 30)
    await escalation.tick()
    async with SessionLocal() as db:
        statuses = {r.status for r in (await db.scalars(select(DispatchLog))).all()}
    assert statuses == {"dry_run"}
    assert get_settings().outbound_mode == "dry_run" and ref
