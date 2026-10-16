import asyncio

import httpx
from sqlalchemy import select

from app import llm, outbound, sessions
from app.config import get_settings
from app.db import DispatchLog, SessionLocal
from app.events import bus
from app.llm import ScriptedChatModel
from app.main import create_app
from app.tools import maps
from app.workflows import emergency

WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghiJKL-mnoPQRstuVWXyz0123456789"


async def _rows(kind):
    async with SessionLocal() as db:
        return (await db.scalars(select(DispatchLog).where(DispatchLog.kind == kind))).all()


def test_discord_recipient_hides_token():
    assert outbound.discord_recipient(WEBHOOK) == "discord:123456789012345678"
    assert outbound.discord_recipient("https://evil.example/api/webhooks/1/x") is None


async def test_discord_alert_via_fallback_never_leaks_token(monkeypatch):
    monkeypatch.setattr(maps, "reverse_geocode", lambda lat, lng: asyncio.sleep(0, {"address": None}))
    llm.set_model_override(lambda name: ScriptedChatModel(script=[RuntimeError("LLM down")]))
    sid = (await sessions.create_session()).id
    await sessions.set_trusted_contact(sid, "Sara", "+923001234567", WEBHOOK)
    em_id = await emergency.start(sid, {"lat": 31.52, "lng": 74.35}, None)
    await asyncio.gather(*list(emergency._tasks))
    rows = await _rows("discord")
    assert [(r.recipient, r.status, r.public_ref) for r in rows] == [("discord:123456789012345678", "dry_run", f"em{em_id}:alert")]
    hist = await bus.history(sid)
    assert "abcDEF" not in str(hist)
    assert any(e["kind"] == "outbound" and e["data"]["kind"] == "discord" and "google.com/maps" in e["data"]["body"] for e in hist)
    await emergency.mark_safe(sid)
    assert len(await _rows("discord")) == 2


async def test_discord_only_contact(monkeypatch):
    monkeypatch.setattr(maps, "reverse_geocode", lambda lat, lng: asyncio.sleep(0, {"address": None}))
    llm.set_model_override(lambda name: ScriptedChatModel(script=[RuntimeError("LLM down")]))
    sid = (await sessions.create_session()).id
    await sessions.set_trusted_contact(sid, "Sara", None, WEBHOOK)
    await emergency.start(sid, None, "near the main gate")
    await asyncio.gather(*list(emergency._tasks))
    assert len(await _rows("discord")) == 1 and await _rows("sms") == []


async def test_discord_live_send(monkeypatch):
    monkeypatch.setenv("OUTBOUND_MODE", "sandbox")
    monkeypatch.setenv("OUTBOUND_ALLOWLIST", "discord:*")
    get_settings.cache_clear()
    sent = []

    class Fake:
        def send(self, url, content):
            sent.append((url, content))
            return "998877"

    monkeypatch.setattr(outbound, "discord_sender_factory", lambda: Fake())
    sid = (await sessions.create_session()).id
    await sessions.set_trusted_contact(sid, "Sara", None, WEBHOOK)
    app = create_app(with_lifespan=False)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = (await c.post(f"/api/sessions/{sid}/discord-test")).json()
        assert r["status"] == "sent" and r["sid"] == "998877" and sent[0][0] == WEBHOOK
        bad = await c.put(f"/api/sessions/{sid}/settings", json={"trusted_contact": {"name": "x", "discord_webhook": "https://x.com/hook"}})
        assert bad.status_code == 422
        info = (await c.get(f"/api/sessions/{sid}")).json()
        assert info["trusted_contact"]["has_discord"] is True and "abcDEF" not in str(info)


async def test_geocoder_falls_back_and_never_raises(monkeypatch):
    async def boom(lat, lng):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(maps, "_nominatim", boom)
    monkeypatch.setattr(maps, "_google", boom)
    res = await maps.reverse_geocode(31.5, 74.3)
    assert res["address"] is None and res["source"] == "coordinates_only"


def test_short_address():
    body = {"display_name": "long", "address": {"road": "Gurumangat Road", "suburb": "Gulberg", "city": "Lahore"}}
    assert maps._short_address(body) == "Gurumangat Road, Gulberg, Lahore"


async def test_default_discord_webhook_from_env(monkeypatch):
    monkeypatch.setenv("DEFAULT_DISCORD_WEBHOOK", WEBHOOK)
    get_settings.cache_clear()
    monkeypatch.setattr(maps, "reverse_geocode", lambda lat, lng: asyncio.sleep(0, {"address": None}))
    llm.set_model_override(lambda name: ScriptedChatModel(script=[RuntimeError("LLM down")]))
    sid = (await sessions.create_session()).id  # no Setup at all
    await emergency.start(sid, {"lat": 33.68, "lng": 73.04}, None)
    await asyncio.gather(*list(emergency._tasks))
    assert [r.recipient for r in await _rows("discord")] == ["discord:123456789012345678"]


async def test_macrodroid_call(monkeypatch):
    monkeypatch.setenv("OUTBOUND_MODE", "live")
    monkeypatch.setenv("CALL_PROVIDER", "macrodroid")
    monkeypatch.setenv("MACRODROID_URL", "https://trigger.macrodroid.com/dev123/")
    monkeypatch.setenv("MACRODROID_CALL_URL", "")
    get_settings.cache_clear()
    hits = []

    class Resp:
        status_code = 200

        def raise_for_status(self):
            pass

    monkeypatch.setattr(outbound, "call_provider_factory", lambda: outbound.place_call)
    monkeypatch.setattr(outbound.httpx, "get", lambda url, params, timeout: hits.append((url, params)) or Resp())
    res = await outbound.guard.dispatch(kind="call", key="em1:alert", recipient="+923001234567", session_id="s",
                                        payload={"say_text": "Awaaz alert, please check your messages."})
    assert res.status == "sent" and res.provider_id.startswith("macrodroid-")
    assert hits[0][0].endswith("/awaaz_call") and hits[0][1]["to"] == "+923001234567"
