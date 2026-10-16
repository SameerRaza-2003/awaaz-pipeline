import asyncio
import time

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.db import Emergency, SessionLocal

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
_nominatim_lock = asyncio.Lock()
_nominatim_last = 0.0


def build_maps_link(lat: float, lng: float) -> str:
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError("coordinates out of range")
    return f"https://www.google.com/maps?q={lat:.6f},{lng:.6f}"


async def get_latest_location(session_id: str) -> dict:
    async with SessionLocal() as db:
        em = await db.scalar(
            select(Emergency).where(Emergency.session_id == session_id).order_by(Emergency.id.desc()).limit(1)
        )
    if em is None or em.last_lat is None or em.last_lng is None:
        return {
            "location_available": False,
            "note": em.location_note if em else None,
        }
    return {
        "location_available": True,
        "lat": em.last_lat,
        "lng": em.last_lng,
        "accuracy_m": em.last_accuracy,
        "captured_at": em.last_location_at.isoformat() if em.last_location_at else None,
        "note": em.location_note,
    }


async def _google(lat: float, lng: float) -> dict:
    key = get_settings().google_maps_api_key
    if not key:
        return {"address": None, "reason": "no GOOGLE_MAPS_API_KEY"}
    async with httpx.AsyncClient(timeout=8) as client:
        r = await client.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"latlng": f"{lat},{lng}", "key": key},
        )
        r.raise_for_status()
        body = r.json()
    results = body.get("results") or []
    if body.get("status") != "OK" or not results:
        return {"address": None, "reason": body.get("status")}
    return {"address": results[0].get("formatted_address"), "source": "google_geocoding"}


async def _nominatim(lat: float, lng: float) -> dict:
    """OpenStreetMap Nominatim: free, no key. Usage policy: max 1 request/s and an identifying User-Agent."""
    global _nominatim_last
    s = get_settings()
    agent = f"Awaaz/0.1 ({s.nominatim_email})" if s.nominatim_email else "Awaaz/0.1"
    async with _nominatim_lock:
        wait = 1.0 - (time.monotonic() - _nominatim_last)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            async with httpx.AsyncClient(timeout=8, headers={"User-Agent": agent}) as client:
                r = await client.get(
                    NOMINATIM_URL,
                    params={"lat": lat, "lon": lng, "format": "jsonv2", "accept-language": "en", "zoom": 18},
                )
                r.raise_for_status()
                body = r.json()
        finally:
            _nominatim_last = time.monotonic()
    if not body.get("display_name"):
        return {"address": None, "reason": body.get("error", "no result")}
    return {"address": _short_address(body), "source": "openstreetmap", "attribution": "© OpenStreetMap contributors"}


def _short_address(body: dict) -> str:
    """'Gurumangat Road, Gulberg, Lahore' instead of the full administrative chain."""
    a = body.get("address") or {}
    parts = [
        a.get("house_number") and f"{a.get('house_number')} {a.get('road', '')}".strip() or a.get("road"),
        a.get("neighbourhood") or a.get("suburb") or a.get("quarter"),
        a.get("town") or a.get("village"),
        a.get("city") or (a.get("city_district") or a.get("county") or "").replace(" District", "").replace(" Division", "") or None,
    ]
    short = ", ".join(dict.fromkeys(p for p in parts if p))
    return short or body["display_name"]


async def reverse_geocode(lat: float, lng: float) -> dict:
    """Address for coordinates. GEOCODER picks the provider; the other one is the fallback.
    If both fail, the alert still goes out with coordinates and a Maps link."""
    order = [_google, _nominatim] if get_settings().geocoder == "google" else [_nominatim, _google]
    reasons = []
    for fn in order:
        try:
            res = await fn(lat, lng)
        except Exception as e:  # noqa: BLE001
            res = {"address": None, "reason": type(e).__name__}
        if res.get("address"):
            return res
        reasons.append(f"{fn.__name__.strip('_')}: {res.get('reason')}")
    return {"address": None, "source": "coordinates_only", "reason": "; ".join(reasons)}
