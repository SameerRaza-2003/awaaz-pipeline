"""Survivor session helpers. Sensitive working state is kept encrypted in sessions.intake_json_enc."""

import secrets
from typing import Any

from sqlalchemy import select

from app.config import get_settings
from app.crypto import decrypt, decrypt_json, encrypt, encrypt_json
from app.db import SessionLocal, SessionRow, TrustedContact, utcnow


def new_session_id() -> str:
    return "s_" + secrets.token_hex(8)


async def create_session(locale: str = "en", country: str | None = None, user_id: str | None = None) -> SessionRow:
    row = SessionRow(
        id=new_session_id(),
        locale=locale,
        country=(country or get_settings().default_country).upper(),
        phase="gate",
        user_id=user_id,
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


async def set_trusted_contact(session_id: str, name: str, phone: str | None, discord_webhook: str | None = None) -> None:
    async with SessionLocal() as db:
        db.add(TrustedContact(session_id=session_id, name=name, phone=phone, discord_webhook_enc=encrypt(discord_webhook) if discord_webhook else None))
        await db.commit()


async def _latest_contact(session_id: str) -> TrustedContact | None:
    async with SessionLocal() as db:
        return await db.scalar(
            select(TrustedContact)
            .where(TrustedContact.session_id == session_id)
            .order_by(TrustedContact.id.desc())
            .limit(1)
        )


async def get_trusted_contact(session_id: str) -> tuple[str, str | None] | None:
    """Contact for this session: set in Setup for this session, else the one saved in her account."""
    row = await _latest_contact(session_id)
    if row:
        return row.name, row.phone
    from app.accounts import account_contact

    saved = await account_contact(session_id)
    if saved and (saved.get("phone") or saved.get("discord_webhook")):
        return saved.get("name") or "your trusted contact", saved.get("phone")
    return None


async def get_own_discord(session_id: str) -> str | None:
    """Only a webhook entered in Setup for this session (no account or .env fallback)."""
    row = await _latest_contact(session_id)
    return decrypt(row.discord_webhook_enc) if row and row.discord_webhook_enc else None


async def get_contact_discord(session_id: str) -> str | None:
    """Her own webhook first (this session's Setup, then her account), otherwise the .env default."""
    own = await get_own_discord(session_id)
    if own:
        return own
    from app.accounts import account_contact

    saved = await account_contact(session_id)
    if saved and saved.get("discord_webhook"):
        return saved["discord_webhook"]
    return get_settings().default_discord_webhook.strip() or None
