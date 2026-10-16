"""HTTP client the platform uses to reach the police system (service-key authenticated)."""

from typing import Any

import httpx

from app.config import get_settings


def _client() -> httpx.AsyncClient:
    s = get_settings()
    headers = {"X-Service-Key": s.police_service_key}
    if s.police_api_url:
        return httpx.AsyncClient(base_url=s.police_api_url, headers=headers, timeout=15)
    from app.main import app  # in-process police service

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://police.internal", headers=headers, timeout=15)


async def submit(complaint: dict[str, Any]) -> dict[str, Any]:
    async with _client() as c:
        r = await c.post("/api/police/intake", json=complaint)
        r.raise_for_status()
        return r.json()


async def status(police_ref: str) -> dict[str, Any]:
    async with _client() as c:
        r = await c.get(f"/api/police/complaints/{police_ref}/status")
        r.raise_for_status()
        return r.json()
