"""The single gate every SMS, call and email passes through.

Enforces OUTBOUND_MODE, the sandbox allowlist and idempotency via dispatch_log.
"""

import asyncio
import re
import smtplib
import ssl
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Any, Literal, Protocol

import httpx
from xml.sax.saxutils import escape

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import get_settings, normalize_recipient
from app.db import DispatchLog, SessionLocal
from app.events import bus

Kind = Literal["sms", "call", "discord", "community_email", "news_email"]
DISCORD_WEBHOOK_RE = re.compile(r"^https://(?:canary\.|ptb\.)?(?:discord|discordapp)\.com/api/webhooks/(\d{5,25})/([\w-]{20,})/?$")
MAX_SEND_ATTEMPTS = 2
RETRY_BASE_DELAY_S = 1.5


@dataclass
class DispatchResult:
    to: str
    kind: str
    status: str  # sent | dry_run | blocked | failed | duplicate
    provider_id: str | None = None
    error: str | None = None
    mode: str = "dry_run"

    def as_dict(self) -> dict[str, Any]:
        return {
            "to": self.to,
            "kind": self.kind,
            "status": self.status,
            "sid": self.provider_id,
            "error": self.error,
            "mode": self.mode,
        }


class SmsProvider(Protocol):
    def send_sms(self, to: str, body: str) -> str: ...
    def place_call(self, to: str, twiml: str) -> str: ...
    def get_status(self, sid: str) -> str: ...


class EmailSender(Protocol):
    def send(self, to: str, subject: str, body: str) -> str: ...


class TwilioProvider:
    def __init__(self) -> None:
        s = get_settings()
        if not (s.twilio_account_sid and s.twilio_auth_token and s.twilio_from_number):
            raise RuntimeError("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)")
        from twilio.rest import Client

        self.client = Client(s.twilio_account_sid, s.twilio_auth_token)
        self.from_ = s.twilio_from_number

    def send_sms(self, to: str, body: str) -> str:
        return self.client.messages.create(to=to, from_=self.from_, body=body).sid

    def place_call(self, to: str, twiml: str) -> str:
        return self.client.calls.create(to=to, from_=self.from_, twiml=twiml).sid

    def get_status(self, sid: str) -> str:
        if sid.startswith("CA"):
            return self.client.calls(sid).fetch().status
        return self.client.messages(sid).fetch().status


class SmtpEmailSender:
    def __init__(self) -> None:
        s = get_settings()
        if not (s.smtp_user and s.smtp_app_password):
            raise RuntimeError("SMTP is not configured (SMTP_USER / SMTP_APP_PASSWORD)")
        self.s = s

    def send(self, to: str, subject: str, body: str) -> str:
        s = self.s
        msg = EmailMessage()
        msg["From"] = formataddr((s.email_from_name, s.smtp_user))
        msg["To"] = to
        msg["Subject"] = subject
        msg["Reply-To"] = s.email_reply_to or s.smtp_user
        msg["Message-ID"] = make_msgid(domain="awaaz.local")
        msg.set_content(body)
        ctx = ssl.create_default_context()
        if s.smtp_port == 465:
            with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=ctx, timeout=30) as server:
                server.login(s.smtp_user, s.smtp_app_password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=30) as server:
                server.starttls(context=ctx)
                server.login(s.smtp_user, s.smtp_app_password)
                server.send_message(msg)
        return msg["Message-ID"]


class MacroDroidCaller:
    """Free automatic calls: a spare Android phone running MacroDroid places the call from its own SIM.
    The macro is triggered by its webhook URL; `to` and `text` are passed along for macros that use them."""

    def place_call(self, to: str, say_text: str) -> str:
        url = get_settings().macrodroid_call_endpoint
        if not url:
            raise RuntimeError("MacroDroid is not configured (MACRODROID_URL + MACRODROID_CALL_ID)")
        r = httpx.get(url, params={"to": to, "text": say_text[:300]}, timeout=15)
        if r.status_code == 404:
            raise RuntimeError("MacroDroid trigger not found: check MACRODROID_CALL_ID matches the macro's webhook identifier")
        r.raise_for_status()
        return f"macrodroid-{uuid.uuid4().hex[:8]}"


def place_call(to: str, say_text: str) -> str:
    if get_settings().call_provider == "macrodroid":
        return MacroDroidCaller().place_call(to, say_text)
    return sms_provider_factory().place_call(to, twiml_say(say_text))


class DiscordSender:
    """Posts to a Discord channel webhook. Free, no account approval needed."""

    def send(self, webhook_url: str, content: str) -> str:
        r = httpx.post(
            webhook_url.rstrip("/"),
            params={"wait": "true"},
            json={"username": "Awaaz", "content": content[:2000], "allowed_mentions": {"parse": []}},
            timeout=15,
        )
        if r.status_code in (401, 403, 404):
            raise RuntimeError(f"Discord rejected the webhook ({r.status_code}); check the webhook URL")
        r.raise_for_status()
        return str(r.json().get("id", "discord"))


def discord_recipient(webhook_url: str | None) -> str | None:
    """Webhook URLs contain a secret token: logs and events only ever see 'discord:<webhook id>'."""
    m = DISCORD_WEBHOOK_RE.match((webhook_url or "").strip())
    return f"discord:{m.group(1)}" if m else None


# Factories are module level so tests can swap them (and assert they are never called in dry_run).
def sms_provider_factory() -> SmsProvider:
    return TwilioProvider()


def email_sender_factory() -> EmailSender:
    return SmtpEmailSender()


def discord_sender_factory() -> DiscordSender:
    return DiscordSender()


def call_provider_factory():
    return place_call


def twiml_say(text: str) -> str:
    safe = escape(text)
    say = f'<Say voice="alice"><prosody rate="slow">{safe}</prosody></Say>'
    return f"<Response>{say}<Pause length=\"1\"/>{say}</Response>"


def provider_configured(kind: str) -> bool:
    s = get_settings()
    if kind == "sms":
        return bool(s.twilio_account_sid and s.twilio_auth_token and s.twilio_from_number)
    if kind == "call":
        if s.call_provider == "macrodroid":
            return bool(s.macrodroid_call_endpoint)
        return bool(s.twilio_account_sid and s.twilio_auth_token and s.twilio_from_number)
    if kind in ("community_email", "news_email"):
        return bool(s.smtp_user and s.smtp_app_password)
    return True  # discord: the webhook itself is the configuration


def is_valid_recipient(kind: str, recipient: str) -> bool:
    if kind == "discord":
        return recipient.startswith("discord:") and recipient[8:].isdigit()
    if kind in ("sms", "call"):
        digits = recipient.lstrip("+")
        return recipient.startswith("+") and digits.isdigit() and 8 <= len(digits) <= 15
    return "@" in recipient and "." in recipient.split("@")[-1] and " " not in recipient


class OutboundGuard:
    async def dispatch(
        self,
        *,
        kind: Kind,
        key: str,
        recipient: str,
        session_id: str,
        payload: dict[str, Any],
        agent: str | None = None,
        node: str | None = None,
        run_id: str | None = None,
    ) -> DispatchResult:
        s = get_settings()
        mode = s.outbound_mode
        to = normalize_recipient(recipient)

        if not is_valid_recipient(kind, to):
            res = DispatchResult(to, kind, "failed", error="invalid recipient", mode=mode)
            await self._emit(session_id, res, payload, agent, node, run_id)
            return res

        claimed = await self._claim(key, kind, to)
        if claimed is None:
            res = DispatchResult(to, kind, "duplicate", mode=mode)
            await self._emit(session_id, res, payload, agent, node, run_id)
            return res

        if mode == "dry_run":
            res = DispatchResult(to, kind, "dry_run", provider_id=f"dry_{uuid.uuid4().hex[:12]}", mode=mode)
        elif mode == "sandbox" and to not in s.allowlist and not (kind == "discord" and "discord:*" in s.allowlist):
            res = DispatchResult(to, kind, "blocked", error="recipient not in OUTBOUND_ALLOWLIST", mode=mode)
        elif not provider_configured(kind):
            # Not an error: this channel simply is not set up on this server.
            res = DispatchResult(to, kind, "skipped", error=f"no {kind} provider configured", mode=mode)
        else:
            res = await self._send(kind, to, payload, mode)

        await self._finish(claimed, res)
        await self._emit(session_id, res, payload, agent, node, run_id)
        return res

    async def _claim(self, key: str, kind: str, to: str) -> int | None:
        """Insert a pending row; return its id, or None if this exact send already happened or is in flight."""
        async with SessionLocal() as db:
            db.add(DispatchLog(public_ref=key, kind=kind, recipient=to, status="pending"))
            try:
                await db.commit()
            except IntegrityError:
                await db.rollback()
                row = await db.scalar(
                    select(DispatchLog).where(
                        DispatchLog.public_ref == key, DispatchLog.kind == kind, DispatchLog.recipient == to
                    )
                )
                if row is None or row.status not in ("failed", "blocked"):
                    return None
                # A previous attempt failed: allow a bounded retry by re-claiming the row.
                row.status = "pending"
                row.error = None
                await db.commit()
                return row.id
            row = await db.scalar(
                select(DispatchLog).where(
                    DispatchLog.public_ref == key, DispatchLog.kind == kind, DispatchLog.recipient == to
                )
            )
            return row.id if row else None

    async def _finish(self, row_id: int, res: DispatchResult) -> None:
        async with SessionLocal() as db:
            row = await db.get(DispatchLog, row_id)
            if row is None:
                return
            row.status = res.status
            row.provider_id = res.provider_id
            row.error = res.error
            await db.commit()

    async def _send(self, kind: str, to: str, payload: dict[str, Any], mode: str) -> DispatchResult:
        last_error = None
        for attempt in range(MAX_SEND_ATTEMPTS):
            try:
                if kind == "sms":
                    sid = await asyncio.to_thread(sms_provider_factory().send_sms, to, payload["body"])
                elif kind == "call":
                    sid = await asyncio.to_thread(call_provider_factory(), to, payload["say_text"])
                elif kind == "discord":
                    sid = await asyncio.to_thread(discord_sender_factory().send, payload["webhook_url"], payload["body"])
                else:
                    sid = await asyncio.to_thread(
                        email_sender_factory().send, to, payload["subject"], payload["body"]
                    )
                return DispatchResult(to, kind, "sent", provider_id=sid, mode=mode)
            except RuntimeError as e:  # configuration problems are not transient
                return DispatchResult(to, kind, "failed", error=str(e), mode=mode)
            except Exception as e:  # noqa: BLE001
                last_error = f"{type(e).__name__}: {e}"
                if attempt + 1 < MAX_SEND_ATTEMPTS:
                    await asyncio.sleep(RETRY_BASE_DELAY_S * (attempt + 1))
        return DispatchResult(to, kind, "failed", error=last_error, mode=mode)

    async def _emit(self, session_id, res: DispatchResult, payload, agent, node, run_id) -> None:
        data = {**res.as_dict(), "dry_run": res.mode == "dry_run"}
        if res.kind in ("community_email", "news_email"):
            data["subject"] = payload.get("subject")
            data["body_preview"] = (payload.get("body") or "")[:400]
        elif res.kind in ("sms", "discord"):
            data["body"] = payload.get("body")
        else:
            data["say_text"] = payload.get("say_text")
        await bus.publish(session_id, "outbound", agent=agent, node=node, run_id=run_id, data=data)
        if res.status == "failed":
            await bus.publish(
                session_id,
                "error",
                agent=agent,
                node=node,
                run_id=run_id,
                data={"message": f"{res.kind} to {res.to} failed: {res.error}"},
            )


guard = OutboundGuard()


async def delivery_status(sid: str) -> str:
    if not sid or sid.startswith("dry_"):
        return "dry_run" if sid else "unknown"
    if get_settings().outbound_mode == "dry_run":
        return "unknown"
    try:
        return await asyncio.to_thread(sms_provider_factory().get_status, sid)
    except Exception as e:  # noqa: BLE001
        return f"unknown ({type(e).__name__})"
