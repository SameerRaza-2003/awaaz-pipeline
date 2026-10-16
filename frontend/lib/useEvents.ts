"use client";

import { useEffect, useRef, useState } from "react";
import { API, AwaazEvent } from "./api";

/**
 * Subscribes to an SSE stream. On (re)connect the server replays history after the last seen id,
 * so a page refresh rebuilds the whole picture.
 */
export function useEvents(path: string | null) {
  const [events, setEvents] = useState<AwaazEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const lastId = useRef(0);

  useEffect(() => {
    setEvents([]);
    lastId.current = 0;
    if (!path) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      const sep = path.includes("?") ? "&" : "?";
      es = new EventSource(`${API}${path}${lastId.current ? `${sep}last_id=${lastId.current}` : ""}`);
      es.onopen = () => setConnected(true);
      es.onmessage = (m) => {
        try {
          const ev: AwaazEvent = JSON.parse(m.data);
          if (ev.id <= lastId.current) return;
          lastId.current = ev.id;
          setEvents((prev) => [...prev, ev]);
        } catch {}
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!closed) retry = setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [path]);

  return { events, connected };
}
