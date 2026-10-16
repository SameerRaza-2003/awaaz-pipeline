"""Survivor session helpers. Sensitive working state is kept encrypted in sessions.intake_json_enc."""

import secrets
from typing import Any

from sqlalchemy import select

from app.config import get_settings
from app.crypto import decrypt_json, encrypt_json
from app.db import SessionLocal, SessionRow, TrustedContact, utcnow


def new_session_id() -> str:
    return "s_" + secrets.token_hex(8)


async def create_session(locale: str = "en", country: str | None = None) -> SessionRow:
    row = SessionRow(
        id=new_session_id(),
        locale=locale,
        country=(country or get_settings().default_country).upper(),
        phase="gate",
    )
    async with SessionLocal() as db:
        db.add(row)
        await db.commit()
    return row


async def get_session(session_id: str) -> SessionRow | None:
    async with SessionLocal() as db:
        return await db.get(SessionRow, session_id)


async def set_phase(session_id: str, phase: str) -> None:
    async with SessionLocal() as db:
        row = await db.get(SessionRow, session_id)
        if row:
            row.phase = phase
            await db.commit()


async def update_settings(session_id: str, *, country: str | None, locale: str | None) -> None:
    async with SessionLocal() as db:
        row = await db.get(SessionRow, session_id)
        if row is None:
            return
        if country:
            row.country = country.upper()
        if locale:
            row.locale = locale
        await db.commit()


async def load_state(session_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        row = await db.get(SessionRow, session_id)
        if row is None or row.intake_json_enc is None:
            return {}
        return decrypt_json(row.intake_json_enc, {}) or {}


async def save_state(session_id: str, state: dict[str, Any]) -> None:
    async with SessionLocal() as db:
        row = await db.get(SessionRow, session_id)
        if row is None:
            return
        row.intake_json_enc = encrypt_json(state)
        await db.commit()


async def purge_state(session_id: str, keep: dict[str, Any] | None = None) -> None:
    async with SessionLocal() as db:
        row = await db.get(SessionRow, session_id)
        if row is None:
            return
        row.intake_json_enc = encrypt_json(keep) if keep else None
        row.purged_at = utcnow()
        await db.commit()


async def set_trusted_contact(session_id: str, name: str, phone: str) -> None:
    async with SessionLocal() as db:
        db.add(TrustedContact(session_id=session_id, name=name, phone=phone))
        await db.commit()


async def get_trusted_contact(session_id: str) -> tuple[str, str] | None:
    async with SessionLocal() as db:
        row = await db.scalar(
            select(TrustedContact)
            .where(TrustedContact.session_id == session_id)
            .order_by(TrustedContact.id.desc())
            .limit(1)
        )
    if row:
        return row.name, row.phone
    return None
