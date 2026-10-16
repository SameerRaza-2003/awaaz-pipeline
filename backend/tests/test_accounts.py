import asyncio

import httpx
from sqlalchemy import select

from app import llm
from app.db import DispatchLog, SessionLocal
from app.llm import ScriptedChatModel
from app.main import create_app
from app.workflows import emergency

from .helpers import awaaz_dump

WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghiJKL-mnoPQRstuVWXyz0123456789"


def client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(with_lifespan=False)), base_url="http://t")


async def test_register_login_profile_and_delete():
    async with client() as c:
        r = await c.post("/api/auth/register", json={"username": "Sara_K", "password": "longenough1"})
        assert r.status_code == 200 and r.json()["username"] == "sara_k"
        assert (await c.post("/api/auth/register", json={"username": "sara_k", "password": "another123"})).status_code == 409
        assert (await c.post("/api/auth/register", json={"username": "x", "password": "longenough1"})).status_code == 422
        assert (await c.post("/api/auth/register", json={"username": "nina", "password": "short"})).status_code == 422
        assert (await c.post("/api/auth/login", json={"username": "sara_k", "password": "wrong-pass"})).status_code == 401
        tok = (await c.post("/api/auth/login", json={"username": "SARA_K", "password": "longenough1"})).json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        assert (await c.get("/api/me")).status_code == 401
        p = await c.put("/api/me", headers=h, json={"trusted_contact": {"name": "Amma", "phone": "+92 300 1234567", "discord_webhook": WEBHOOK}, "country": "pk"})
        assert p.json()["trusted_contact"] == {"name": "Amma", "phone": "+923001234567", "has_discord": True}
        assert "abcDEF" not in p.text  # the webhook token is never sent back
        bad = await c.put("/api/me", headers=h, json={"trusted_contact": {"name": "Amma", "phone": "12"}})
        assert bad.status_code == 422
        # contact details are stored encrypted, never in plain text
        dump = await awaaz_dump()
        assert "3001234567" not in dump and "Amma" not in dump and "longenough1" not in dump
        assert (await c.delete("/api/me", headers=h)).json()["deleted"]
        assert (await c.get("/api/me", headers=h)).status_code == 401


async def test_signed_in_session_uses_account_contact(monkeypatch):
    llm.set_model_override(lambda name: ScriptedChatModel(script=[RuntimeError("LLM down")]))
    async with client() as c:
        tok = (await c.post("/api/auth/register", json={"username": "hina", "password": "longenough1"})).json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        await c.put("/api/me", headers=h, json={"trusted_contact": {"name": "Amma", "phone": "+923001234567", "discord_webhook": WEBHOOK}})
        sid = (await c.post("/api/sessions", headers=h, json={})).json()["session_id"]
        info = (await c.get(f"/api/sessions/{sid}")).json()
        assert info["signed_in"] and info["trusted_contact"]["name"] == "Amma" and info["trusted_contact"]["has_discord"]
        await c.post(f"/api/sessions/{sid}/danger", json={"answer": "yes", "location": {"lat": 31.5, "lng": 74.3}})
        await asyncio.gather(*list(emergency._tasks))
        # an anonymous session gets nothing from the account
        anon = (await c.post("/api/sessions", json={})).json()["session_id"]
        assert (await c.get(f"/api/sessions/{anon}")).json()["trusted_contact"] is None
    async with SessionLocal() as db:
        rows = (await db.scalars(select(DispatchLog))).all()
    assert {(r.kind, r.recipient) for r in rows} >= {("sms", "+923001234567"), ("call", "+923001234567"), ("discord", "discord:123456789012345678")}
