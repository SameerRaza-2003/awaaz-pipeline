"""Optional survivor accounts. Username + password only; the profile (trusted contact etc.) is stored encrypted."""

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from typing import Any

from sqlalchemy import select

from app.config import get_settings
from app.crypto import decrypt_json, encrypt_json
from app.db import SessionLocal, SessionRow, UserRow

TOKEN_TTL_S = 30 * 24 * 3600
USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,32}$")
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


class AccountError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **_SCRYPT)
    return hmac.compare_digest(candidate.hex(), digest)


def _secret() -> bytes:
    s = get_settings()
    return hashlib.sha256(("user-token:" + s.police_service_key + s.data_encryption_key).encode()).digest()


def issue_token(user_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"uid": user_id, "exp": int(time.time()) + TOKEN_TTL_S}).encode()).decode()
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_token(token: str | None) -> str | None:
    if not token or "." not in token:
        return None
    payload, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(payload.encode()))
    except ValueError:
        return None
    return data.get("uid") if data.get("exp", 0) > time.time() else None


def normalize_username(username: str) -> str:
    u = username.strip().lower()
    if not USERNAME_RE.match(u):
        raise AccountError(422, "Username must be 3-32 characters: letters, numbers, dots or underscores.")
    return u


async def register(username: str, password: str) -> UserRow:
    u = normalize_username(username)
    if len(password) < 8:
        raise AccountError(422, "Password must be at least 8 characters.")
    async with SessionLocal() as db:
        if await db.scalar(select(UserRow).where(UserRow.username == u)):
            raise AccountError(409, "That username is taken.")
        row = UserRow(id="u_" + secrets.token_hex(8), username=u, password_hash=hash_password(password))
        db.add(row)
        await db.commit()
    return row


async def login(username: str, password: str) -> UserRow:
    try:
        u = normalize_username(username)
    except AccountError:
        u = ""
    async with SessionLocal() as db:
        row = await db.scalar(select(UserRow).where(UserRow.username == u)) if u else None
    if row is None or not verify_password(password, row.password_hash):
        raise AccountError(401, "Wrong username or password.")
    return row


async def get_user(user_id: str) -> UserRow | None:
    async with SessionLocal() as db:
        return await db.get(UserRow, user_id)


def profile_of(row: UserRow | None) -> dict[str, Any]:
    return decrypt_json(row.profile_enc, {}) if row and row.profile_enc else {}


async def save_profile(user_id: str, profile: dict[str, Any]) -> None:
    async with SessionLocal() as db:
        row = await db.get(UserRow, user_id)
        if row is None:
            raise AccountError(404, "Account not found.")
        row.profile_enc = encrypt_json(profile)
        await db.commit()


async def delete_user(user_id: str) -> None:
    async with SessionLocal() as db:
        row = await db.get(UserRow, user_id)
        if row:
            await db.delete(row)
        for s in (await db.scalars(select(SessionRow).where(SessionRow.user_id == user_id))).all():
            s.user_id = None
        await db.commit()


async def account_contact(session_id: str) -> dict[str, Any] | None:
    """The trusted contact saved in the signed-in account behind this session, if any."""
    async with SessionLocal() as db:
        sess = await db.get(SessionRow, session_id)
        user = await db.get(UserRow, sess.user_id) if sess and sess.user_id else None
    return profile_of(user).get("trusted_contact") if user else None
