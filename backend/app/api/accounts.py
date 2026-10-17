from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app import accounts
from app.config import normalize_phone
from app.outbound import discord_recipient

router = APIRouter(prefix="/api", tags=["accounts"])


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=200)


class ContactIn(BaseModel):
    name: str = Field(default="", max_length=80)
    phone: str | None = Field(default=None, max_length=24)
    discord_webhook: str | None = Field(default=None, max_length=300)


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=60)
    trusted_contact: ContactIn | None = None
    country: str | None = Field(default=None, max_length=10)
    locale: str | None = Field(default=None, max_length=10)


def optional_user(authorization: str | None = Header(default=None)) -> str | None:
    token = authorization.removeprefix("Bearer ").strip() if authorization else None
    return accounts.verify_token(token)


def current_user(user_id: str | None = Depends(optional_user)) -> str:
    if not user_id:
        raise HTTPException(401, "Please sign in")
    return user_id


def _err(e: accounts.AccountError) -> HTTPException:
    return HTTPException(e.status, e.message)


def public_profile(row, profile: dict) -> dict:
    """What the account page shows: the webhook itself is never sent back, only whether one is saved."""
    contact = dict(profile.get("trusted_contact") or {})
    has_discord = bool(contact.pop("discord_webhook", None))
    return {
        "username": row.username,
        "display_name": profile.get("display_name"),
        "trusted_contact": {**contact, "has_discord": has_discord} if contact or has_discord else None,
        "country": profile.get("country"),
        "locale": profile.get("locale"),
    }


@router.post("/auth/register")
async def register(body: Credentials):
    try:
        row = await accounts.register(body.username, body.password)
    except accounts.AccountError as e:
        raise _err(e) from e
    return {"token": accounts.issue_token(row.id), "username": row.username}


@router.post("/auth/login")
async def login(body: Credentials):
    try:
        row = await accounts.login(body.username, body.password)
    except accounts.AccountError as e:
        raise _err(e) from e
    return {"token": accounts.issue_token(row.id), "username": row.username}


@router.get("/me")
async def me(user_id: str = Depends(current_user)):
    row = await accounts.get_user(user_id)
    if row is None:
        raise HTTPException(401, "Please sign in")
    return public_profile(row, accounts.profile_of(row))


@router.put("/me")
async def update_me(body: ProfileIn, user_id: str = Depends(current_user)):
    row = await accounts.get_user(user_id)
    if row is None:
        raise HTTPException(401, "Please sign in")
    profile = accounts.profile_of(row)
    if body.display_name is not None:
        profile["display_name"] = body.display_name.strip() or None
    if body.country:
        profile["country"] = body.country.upper()
    if body.locale:
        profile["locale"] = body.locale
    if body.trusted_contact is not None:
        tc = body.trusted_contact
        phone = None
        if tc.phone and tc.phone.strip():
            phone = normalize_phone(tc.phone, body.country or profile.get("country"))
            if not phone:
                raise HTTPException(422, "Enter a valid phone number, e.g. 03001234567 or +923001234567")
        webhook = (tc.discord_webhook or "").strip()
        if webhook and not discord_recipient(webhook):
            raise HTTPException(422, "Discord webhook must look like https://discord.com/api/webhooks/<id>/<token>")
        old = profile.get("trusted_contact") or {}
        profile["trusted_contact"] = {
            "name": tc.name.strip() or old.get("name") or "",
            "phone": phone,
            # An empty field keeps the saved webhook (it is never shown back); send "-" to remove it.
            "discord_webhook": None if tc.discord_webhook == "-" else (webhook or old.get("discord_webhook")),
        }
    await accounts.save_profile(user_id, profile)
    return public_profile(row, profile)


@router.delete("/me")
async def delete_me(user_id: str = Depends(current_user)):
    await accounts.delete_user(user_id)
    return {"deleted": True}
