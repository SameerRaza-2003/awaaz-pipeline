import asyncio
import json
import re
from collections import defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy import select, update

from app.db import EventRow, SessionLocal, utcnow

SYSTEM_STREAM = "system"
POLICE_STREAM = "police"

EVENT_KINDS = {
    "agent.start",
    "agent.end",
    "tool.start",
    "tool.end",
    "llm.message",
    "step",
    "outbound",
    "status",
    "error",
    "workflow.start",
    "workflow.end",
}

# Keys whose values never belong in the platform event log (they are police-only).
SENSITIVE_KEYS = {
    "police_text",
    "complainant_name",
    "complainant_contact",
    "complainant_address",
    "accused",
    "full_text",
    "known_entities",
}

PHONE_RE = re.compile(r"(?<![\w/])\+?\d[\d\s\-()]{7,}\d(?![\w/])")
EMAIL_RE = re.compile(r"([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")


def mask_phone(text: str) -> str:
    """+92 300 1234567 -> +92 3** *** *567"""

    def repl(m: re.Match) -> str:
        raw = m.group(0)
        digits = [c for c in raw if c.isdigit()]
        if len(digits) < 8:
            return raw
        plus = "+" if raw.strip().startswith("+") else ""
        if plus and len(digits) > 10:
            cc, rest = "".join(digits[:2]), digits[2:]
        else:
            cc, rest = "", digits
        head = rest[0]
        tail = "".join(rest[-3:])
        middle = len(rest) - 4
        stars = "*" * middle
        parts = [f"{head}{stars[:2]}", stars[2:5], f"{stars[5:]}{tail}"]
        masked = " ".join(p for p in parts if p)
        return f"{plus}{cc} {masked}".strip() if cc else f"{plus}{masked}"

    return PHONE_RE.sub(repl, text)


def mask_email(text: str) -> str:
    return EMAIL_RE.sub(lambda m: f"{m.group(1)}***{m.group(2)}", text)


def mask(value: Any, *, emails: bool = False) -> Any:
    if isinstance(value, str):
        out = mask_phone(value)
        return mask_email(out) if emails else out
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if k in SENSITIVE_KEYS and v not in (None, "", [], {}):
                out[k] = "[police only: hidden]"
            else:
                out[k] = mask(v, emails=emails)
        return out
    if isinstance(value, (list, tuple)):
        return [mask(v, emails=emails) for v in value]
    return value


def _jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, default=_default, ensure_ascii=False))


def _default(o: Any) -> Any:
    if isinstance(o, datetime):
        return o.isoformat()
    if hasattr(o, "model_dump"):
        return o.model_dump(mode="json")
    return str(o)


def serialize(row: EventRow) -> dict[str, Any]:
    return {
        "id": row.id,
        "session_id": row.session_id,
        "ts": row.ts.isoformat().replace("+00:00", "Z"),
        "kind": row.kind,
        "agent": row.agent,
        "node": row.node,
        "run_id": row.run_id,
        "data": json.loads(row.data_json or "{}"),
    }


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._lock: asyncio.Lock | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def _get_lock(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._loop is not loop:
            self._lock, self._loop = asyncio.Lock(), loop
        return self._lock

    async def publish(
        self,
        session_id: str,
        kind: str,
        *,
        agent: str | None = None,
        node: str | None = None,
        run_id: str | None = None,
        data: dict[str, Any] | None = None,
        also: tuple[str, ...] = (),
    ) -> dict[str, Any]:
        payload = mask(_jsonable(data or {}))
        async with self._get_lock():
            async with SessionLocal() as db:
                row = EventRow(
                    session_id=session_id,
                    ts=utcnow(),
                    kind=kind,
                    agent=agent,
                    node=node or agent,
                    run_id=run_id,
                    data_json=json.dumps(payload, ensure_ascii=False),
                )
                db.add(row)
                await db.commit()
                await db.refresh(row)
                event = serialize(row)
        for stream in (session_id, *also):
            for q in list(self._subs.get(stream, ())):
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    pass
        return event

    def subscribe(self, stream: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subs[stream].add(q)
        return q

    def unsubscribe(self, stream: str, q: asyncio.Queue) -> None:
        self._subs.get(stream, set()).discard(q)

    async def history(self, stream: str, after_id: int = 0, limit: int = 2000) -> list[dict[str, Any]]:
        async with SessionLocal() as db:
            rows = (
                await db.scalars(
                    select(EventRow)
                    .where(EventRow.session_id == stream, EventRow.id > after_id)
                    .order_by(EventRow.id)
                    .limit(limit)
                )
            ).all()
        return [serialize(r) for r in rows]

    async def redact_session(self, session_id: str, agents: tuple[str, ...]) -> None:
        """Drop conversational payloads of the given agents once the transcript is purged."""
        async with SessionLocal() as db:
            await db.execute(
                update(EventRow)
                .where(
                    EventRow.session_id == session_id,
                    EventRow.agent.in_(agents),
                    EventRow.kind.in_(("llm.message", "tool.start", "tool.end")),
                )
                .values(data_json=json.dumps({"redacted": True}))
            )
            await db.commit()


bus = EventBus()
