"""The single gate every SMS, call and email passes through.

Enforces OUTBOUND_MODE, the sandbox allowlist and idempotency via dispatch_log.
"""

import asyncio
import smtplib
import ssl
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Any, Literal, Protocol
from xml.sax.saxutils import escape

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import get_settings, normalize_recipient
from app.db import DispatchLog, SessionLocal
from app.events import bus

Kind = Literal["sms", "call", "community_email", "news_email"]
MAX_SEND_ATTEMPTS = 2


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


# Factories are module level so tests can swap them (and assert they are never called in dry_run).
def sms_provider_factory() -> SmsProvider:
    return TwilioProvider()


def email_sender_factory() -> EmailSender:
    return SmtpEmailSender()


def twiml_say(text: str) -> str:
    safe = escape(text)
    say = f'<Say voice="alice"><prosody rate="slow">{safe}</prosody></Say>'
    return f"<Response>{say}<Pause length=\"1\"/>{say}</Response>"


def is_valid_recipient(kind: str, recipient: str) -> bool:
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
        elif mode == "sandbox" and to not in s.allowlist:
            res = DispatchResult(to, kind, "blocked", error="recipient not in OUTBOUND_ALLOWLIST", mode=mode)
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
                    sid = await asyncio.to_thread(sms_provider_factory().place_call, to, twiml_say(payload["say_text"]))
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
                    await asyncio.sleep(1.5 * (attempt + 1))
        return DispatchResult(to, kind, "failed", error=last_error, mode=mode)

    async def _emit(self, session_id, res: DispatchResult, payload, agent, node, run_id) -> None:
        data = {**res.as_dict(), "dry_run": res.mode == "dry_run"}
        if res.kind in ("community_email", "news_email"):
            data["subject"] = payload.get("subject")
            data["body_preview"] = (payload.get("body") or "")[:400]
        elif res.kind == "sms":
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
