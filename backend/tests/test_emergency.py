import asyncio

from sqlalchemy import select

from app import llm, outbound, sessions
from app.config import get_settings
from app.db import DispatchLog, SessionLocal
from app.events import bus, mask_phone
from app.llm import ScriptedChatModel, final, tool_call
from app.workflows import emergency

CONTACT = "+923001234567"


async def _session_with_contact():
    row = await sessions.create_session()
    await sessions.set_trusted_contact(row.id, "Sara", CONTACT)
    return row.id


def _agents_script(lat=31.52, lng=74.35):
    link = f"https://www.google.com/maps?q={lat:.6f},{lng:.6f}"

    def by_agent(name):
        if name == "location_agent":
            return ScriptedChatModel(
                script=[
                    tool_call("get_latest_location"),
                    tool_call("reverse_geocode", lat=lat, lng=lng),
                    tool_call("build_maps_link", lat=lat, lng=lng),
                    final("LocationReport", location_available=True, lat=lat, lng=lng, accuracy_m=12, maps_link=link),
                ]
            )
        return ScriptedChatModel(
            script=[
                tool_call("send_sms", to=CONTACT, body="Sara, I may be in danger. Please come now."),
                tool_call("place_call", to=CONTACT, say_text="This is Awaaz. Your friend needs help now."),
                final("AlertResult", sms=[{"to": CONTACT, "status": "dry_run"}], call={"to": CONTACT, "status": "dry_run"}),
            ]
        )

    return by_agent


async def _rows(key):
    async with SessionLocal() as db:
        return (await db.scalars(select(DispatchLog).where(DispatchLog.public_ref == key))).all()


async def test_emergency_dry_run_with_agents():
    llm.set_model_override(_agents_script())
    sid = await _session_with_contact()
    em_id = await emergency.start(sid, {"lat": 31.52, "lng": 74.35, "accuracy": 12}, None)
    result = await emergency.run(sid, em_id)  # run again synchronously: must be idempotent
    await asyncio.gather(*list(emergency._tasks))
    rows = await _rows(f"em{em_id}:alert")
    kinds = sorted((r.kind, r.status) for r in rows)
    assert kinds == [("call", "dry_run"), ("sms", "dry_run")]
    assert result["location"]["maps_link"].startswith("https://www.google.com/maps?q=31.52")
    hist = await bus.history(sid)
    assert any(e["kind"] == "outbound" and e["data"]["dry_run"] for e in hist)
    # phone numbers are masked in the event stream
    assert not any(CONTACT in str(e["data"]) for e in hist)
    # the SMS body always contains the maps link even if the agent forgot it
    sms_ev = next(e for e in hist if e["kind"] == "outbound" and e["data"]["kind"] == "sms")
    assert "google.com/maps" in sms_ev["data"]["body"]


async def test_fallback_when_llm_dies():
    llm.set_model_override(lambda name: ScriptedChatModel(script=[RuntimeError("LLM down")]))
    sid = await _session_with_contact()
    em_id = await emergency.start(sid, {"lat": 24.86, "lng": 67.0, "accuracy": 30}, None)
    await asyncio.gather(*list(emergency._tasks))
    rows = await _rows(f"em{em_id}:alert")
    assert sorted(r.kind for r in rows) == ["call", "sms"]
    hist = await bus.history(sid)
    assert any(e["kind"] == "step" and e["data"].get("fallback") for e in hist)


async def test_fallback_when_agent_only_sends_sms():
    def by_agent(name):
        if name == "location_agent":
            return ScriptedChatModel(script=[RuntimeError("x")])
        return ScriptedChatModel(script=[tool_call("send_sms", to=CONTACT, body="Help needed now please."), RuntimeError("died")])

    llm.set_model_override(by_agent)
    sid = await _session_with_contact()
    em_id = await emergency.start(sid, None, "near Liberty Market")
    await asyncio.gather(*list(emergency._tasks))
    rows = await _rows(f"em{em_id}:alert")
    assert sorted(r.kind for r in rows) == ["call", "sms"]  # exactly one sms: no double send


async def test_agent_cannot_message_other_numbers():
    def by_agent(name):
        if name == "location_agent":
            return ScriptedChatModel(script=[RuntimeError("x")])
        return ScriptedChatModel(
            script=[
                tool_call("send_sms", to="+15550001111", body="Hello stranger, this is a test."),
                final("AlertResult", sms=[], call=None),
            ]
        )

    llm.set_model_override(by_agent)
    sid = await _session_with_contact()
    em_id = await emergency.start(sid, None, None)
    await asyncio.gather(*list(emergency._tasks))
    rows = await _rows(f"em{em_id}:alert")
    assert {r.recipient for r in rows} == {CONTACT}


async def test_sandbox_blocks_non_allowlisted(monkeypatch):
    monkeypatch.setenv("OUTBOUND_MODE", "sandbox")
    monkeypatch.setenv("OUTBOUND_ALLOWLIST", "+923331112222")
    get_settings.cache_clear()
    res = await outbound.guard.dispatch(kind="sms", key="k1", recipient=CONTACT, session_id="s", payload={"body": "hi there"})
    assert res.status == "blocked"


async def test_sandbox_sends_to_allowlisted(monkeypatch):
    monkeypatch.setenv("OUTBOUND_MODE", "sandbox")
    monkeypatch.setenv("OUTBOUND_ALLOWLIST", CONTACT)
    get_settings.cache_clear()
    sent = []

    class FakeTwilio:
        def send_sms(self, to, body):
            sent.append((to, body))
            return "SM123"

    monkeypatch.setattr(outbound, "sms_provider_factory", lambda: FakeTwilio())
    res = await outbound.guard.dispatch(kind="sms", key="k2", recipient=CONTACT, session_id="s", payload={"body": "hi there"})
    assert res.status == "sent" and res.provider_id == "SM123" and sent == [(CONTACT, "hi there")]
    again = await outbound.guard.dispatch(kind="sms", key="k2", recipient=CONTACT, session_id="s", payload={"body": "hi there"})
    assert again.status == "duplicate" and len(sent) == 1


async def test_live_failure_retries_and_logs(monkeypatch):
    monkeypatch.setenv("OUTBOUND_MODE", "live")
    get_settings.cache_clear()
    monkeypatch.setattr(outbound, "RETRY_BASE_DELAY_S", 0)
    calls = []

    class Broken:
        def send(self, to, subject, body):
            calls.append(to)
            raise ConnectionError("smtp down")

    monkeypatch.setattr(outbound, "email_sender_factory", lambda: Broken())
    res = await outbound.guard.dispatch(kind="community_email", key="R1", recipient="a@b.org", session_id="s",
                                        payload={"subject": "s", "body": "b"})
    assert res.status == "failed" and len(calls) == outbound.MAX_SEND_ATTEMPTS
    hist = await bus.history("s")
    assert any(e["kind"] == "error" for e in hist)


async def test_tracking_throttle_and_safe(monkeypatch):
    monkeypatch.setenv("TRACKING_INTERVAL_S", "0")
    monkeypatch.setenv("TRACKING_MAX_UPDATES", "2")
    get_settings.cache_clear()
    llm.set_model_override(lambda name: ScriptedChatModel(script=[RuntimeError("x")]))
    sid = await _session_with_contact()
    em_id = await emergency.start(sid, {"lat": 31.5, "lng": 74.3}, None)
    await asyncio.gather(*list(emergency._tasks))
    r1 = await emergency.tracking_update(sid, 31.51, 74.31, 10)
    r2 = await emergency.tracking_update(sid, 31.52, 74.32, 10)
    r3 = await emergency.tracking_update(sid, 31.53, 74.33, 10)
    assert r1["sent"] and r2["sent"] and not r3["sent"]
    assert (await emergency.mark_safe(sid))["ok"]
    assert len(await _rows(f"em{em_id}:safe")) == 1
    assert (await emergency.tracking_update(sid, 31.6, 74.4, 5))["tracking"] is False


def test_mask_phone():
    assert mask_phone("+92 300 1234567") == "+92 3** *** *567"
    assert mask_phone("+923001234567") == "+92 3** *** *567"


def test_discord_id_is_not_masked_as_phone():
    assert mask_phone("discord:1560736918616936665") == "discord:1560736918616936665"
