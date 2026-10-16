import asyncio
import json

from fastapi import Request
from sse_starlette.sse import EventSourceResponse

from app.events import bus

KEEPALIVE_S = 15


def event_stream(request: Request, streams: list[str], last_event_id: int | None) -> EventSourceResponse:
    """Replay persisted events after Last-Event-ID, then stream live ones (deduplicated by id)."""

    async def gen():
        queues = [(s, bus.subscribe(s)) for s in streams]
        try:
            replay: list[dict] = []
            for s in streams:
                replay.extend(await bus.history(s, after_id=last_event_id or 0))
            replay.sort(key=lambda e: e["id"])
            seen = 0
            for ev in replay:
                seen = max(seen, ev["id"])
                yield {"id": str(ev["id"]), "event": "message", "data": json.dumps(ev, ensure_ascii=False)}
            merged: asyncio.Queue = asyncio.Queue()

            async def pump(q: asyncio.Queue):
                while True:
                    await merged.put(await q.get())

            pumps = [asyncio.create_task(pump(q)) for _, q in queues]
            try:
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        ev = await asyncio.wait_for(merged.get(), timeout=KEEPALIVE_S)
                    except TimeoutError:
                        yield {"event": "ping", "data": "{}"}
                        continue
                    if ev["id"] <= seen:
                        continue
                    seen = ev["id"]
                    yield {"id": str(ev["id"]), "event": "message", "data": json.dumps(ev, ensure_ascii=False)}
            finally:
                for p in pumps:
                    p.cancel()
        finally:
            for s, q in queues:
                bus.unsubscribe(s, q)

    return EventSourceResponse(gen())


def parse_last_id(request: Request, last_id: int | None) -> int | None:
    header = request.headers.get("last-event-id")
    if header and header.isdigit():
        return int(header)
    return last_id
