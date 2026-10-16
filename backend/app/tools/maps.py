import httpx
from sqlalchemy import select

from app.config import get_settings
from app.db import Emergency, SessionLocal


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


async def reverse_geocode(lat: float, lng: float) -> dict:
    key = get_settings().google_maps_api_key
    if not key:
        return {"address": None, "source": "coordinates_only", "reason": "no GOOGLE_MAPS_API_KEY"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                "https://maps.googleapis.com/maps/api/geocode/json",
                params={"latlng": f"{lat},{lng}", "key": key},
            )
            r.raise_for_status()
            body = r.json()
        results = body.get("results") or []
        if body.get("status") != "OK" or not results:
            return {"address": None, "source": "coordinates_only", "reason": body.get("status")}
        return {"address": results[0].get("formatted_address"), "source": "google_geocoding"}
    except Exception as e:  # noqa: BLE001
        return {"address": None, "source": "coordinates_only", "reason": type(e).__name__}
