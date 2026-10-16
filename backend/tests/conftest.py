import os

import pytest

os.environ.setdefault("OUTBOUND_MODE", "dry_run")
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["EMBEDDING_PROVIDER"] = "hash"


@pytest.fixture(autouse=True)
async def fresh_env(tmp_path, monkeypatch):
    from app import crypto, db, llm, outbound
    from app.config import get_settings
    from app.police import db as police_db

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OUTBOUND_MODE", "dry_run")
    monkeypatch.setenv("SCHEDULER_POLL_S", "0.2")
    monkeypatch.setenv("GEOCODER", "nominatim")
    monkeypatch.setenv("PRIVACY_LLM_REVIEW", "false")
    monkeypatch.setenv("DEFAULT_DISCORD_WEBHOOK", "")
    monkeypatch.setenv("NEWS_AGENCY_EMAIL", "")  # tests use the seeded agencies
    monkeypatch.setenv("DEFAULT_TRUSTED_CONTACT", "")  # enabled explicitly in test_privacy.py
    get_settings.cache_clear()
    crypto.reset()

    def _no_network(*a, **k):
        raise AssertionError("network provider must not be used in this test")

    monkeypatch.setattr(outbound, "sms_provider_factory", _no_network)
    monkeypatch.setattr(outbound, "email_sender_factory", _no_network)
    monkeypatch.setattr(outbound, "discord_sender_factory", _no_network)
    monkeypatch.setattr(outbound, "call_provider_factory", _no_network)

    from app.tools import maps

    async def _no_geocode(lat, lng):
        return {"address": None, "reason": "geocoding disabled in tests"}

    monkeypatch.setattr(maps, "_nominatim", _no_geocode)
    monkeypatch.setattr(maps, "_google", _no_geocode)

    await db.init_db()
    await police_db.init_police_db()
    yield
    llm.set_model_override(None)
    await db.close_db()
    await police_db.close_police_db()
    get_settings.cache_clear()
