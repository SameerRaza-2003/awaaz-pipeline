import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select

from app.config import get_settings
from app.crypto import decrypt, encrypt
from app.db import utcnow
from app.events import POLICE_STREAM, bus
from app.police.db import STATUSES, Complaint, PoliceSession, StatusHistory

TOKEN_TTL_S = 12 * 3600


class ComplaintIn(BaseModel):
    public_ref: str = Field(min_length=4, max_length=40)
    full_text: str = Field(min_length=20)
    complainant_name: str | None = None
    complainant_contact: str | None = None
    complainant_address: str | None = None
    accused: str | None = None
    country: str = Field(min_length=2, max_length=10)
    city: str | None = None
    harassment_type: str | None = None


def _secret() -> bytes:
    s = get_settings()
    return hashlib.sha256(("police-token:" + s.police_service_key + s.data_encryption_key).encode()).digest()


def issue_token(username: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"u": username, "exp": int(time.time()) + TOKEN_TTL_S}).encode())
    sig = hmac.new(_secret(), payload, hashlib.sha256).hexdigest()
    return f"{payload.decode()}.{sig}"


def verify_token(token: str | None) -> str | None:
    if not token or "." not in token:
        return None
    payload, sig = token.rsplit(".", 1)
    expected = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(payload.encode()))
    except ValueError:
        return None
    if data.get("exp", 0) < time.time():
        return None
    return data.get("u")


def check_login(username: str, password: str) -> bool:
    s = get_settings()
    return bool(s.police_demo_user) and hmac.compare_digest(username, s.police_demo_user) and hmac.compare_digest(
        password, s.police_demo_password
    )


def check_service_key(key: str | None) -> bool:
    return bool(key) and hmac.compare_digest(key, get_settings().police_service_key)  # type: ignore[arg-type]


def _new_police_ref() -> str:
    return f"BH-{secrets.randbelow(900000) + 100000}"


async def intake(c: ComplaintIn) -> Complaint:
    async with PoliceSession() as db:
        existing = await db.scalar(select(Complaint).where(Complaint.public_ref == c.public_ref))
        if existing:  # idempotent on public_ref
            return existing
        while True:
            ref = _new_police_ref()
            if await db.get(Complaint, ref) is None:
                break
        now = utcnow()
        row = Complaint(
            police_ref=ref,
            public_ref=c.public_ref,
            received_at=now,
            status="NEW",
            full_text_enc=encrypt(c.full_text),
            complainant_name_enc=encrypt(c.complainant_name),
            complainant_contact_enc=encrypt(c.complainant_contact),
            complainant_address_enc=encrypt(c.complainant_address),
            accused_enc=encrypt(c.accused),
            country=c.country.upper(),
            city=c.city,
            harassment_type=c.harassment_type,
            last_updated=now,
        )
        db.add(row)
        db.add(StatusHistory(police_ref=ref, status="NEW", changed_at=now, note="Complaint received"))
        await db.commit()
    await bus.publish(
        POLICE_STREAM,
        "status",
        agent="police_system",
        node="police_dispatch_agent",
        data={
            "message": f"New complaint {ref} received",
            "police_ref": ref,
            "city": c.city,
            "harassment_type": c.harassment_type,
        },
    )
    return row


def summary(c: Complaint) -> dict[str, Any]:
    return {
        "police_ref": c.police_ref,
        "public_ref": c.public_ref,
        "received_at": c.received_at.isoformat(),
        "status": c.status,
        "country": c.country,
        "city": c.city,
        "harassment_type": c.harassment_type,
        "last_updated": c.last_updated.isoformat(),
    }


async def list_complaints() -> list[Complaint]:
    async with PoliceSession() as db:
        return list((await db.scalars(select(Complaint).order_by(Complaint.received_at.desc()))).all())


async def get_complaint(police_ref: str) -> Complaint | None:
    async with PoliceSession() as db:
        return await db.get(Complaint, police_ref)


async def detail(police_ref: str) -> dict[str, Any] | None:
    async with PoliceSession() as db:
        c = await db.get(Complaint, police_ref)
        if c is None:
            return None
        hist = (
            await db.scalars(
                select(StatusHistory).where(StatusHistory.police_ref == police_ref).order_by(StatusHistory.id)
            )
        ).all()
    return {
        **summary(c),
        "full_text": decrypt(c.full_text_enc),
        "complainant_name": decrypt(c.complainant_name_enc),
        "complainant_contact": decrypt(c.complainant_contact_enc),
        "complainant_address": decrypt(c.complainant_address_enc),
        "accused": decrypt(c.accused_enc),
        "history": [
            {"status": h.status, "changed_at": h.changed_at.isoformat(), "note": h.note} for h in hist
        ],
    }


async def update_status(police_ref: str, status: str, note: str | None, actor: str) -> Complaint | None:
    status = status.upper()
    if status not in STATUSES:
        raise ValueError(f"unknown status {status}")
    async with PoliceSession() as db:
        c = await db.get(Complaint, police_ref)
        if c is None:
            return None
        c.status = status
        c.last_updated = utcnow()
        db.add(StatusHistory(police_ref=police_ref, status=status, note=note or f"Updated by {actor}"))
        await db.commit()
    await bus.publish(
        POLICE_STREAM,
        "status",
        agent="police_system",
        node="police_status_agent",
        data={"message": f"{police_ref} marked {status}", "police_ref": police_ref, "status": status},
    )
    return c
