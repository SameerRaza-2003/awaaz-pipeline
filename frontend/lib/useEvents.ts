"use client";

import { useEffect, useRef, useState } from "react";
import { API, AwaazEvent } from "./api";

/**
 * Subscribes to an SSE stream. On (re)connect the server replays history after the last seen id,
 * so a page refresh rebuilds the whole picture.
 *
 * `stillValid` is asked after a connection error: return false when the stream can never work again
 * (session deleted, police login expired) and the hook stops retrying instead of looping.
 */
export function useEvents(path: string | null, stillValid?: () => Promise<boolean>) {
  const [events, setEvents] = useState<AwaazEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const lastId = useRef(0);
  const validRef = useRef(stillValid);
  useEffect(() => {
    validRef.current = stillValid;
  }, [stillValid]);

  useEffect(() => {
    setEvents([]);
    lastId.current = 0;
    if (!path) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = 2000;

    const open = () => {
      const sep = path.includes("?") ? "&" : "?";
      es = new EventSource(`${API}${path}${lastId.current ? `${sep}last_id=${lastId.current}` : ""}`);
      es.onopen = () => {
        setConnected(true);
        delay = 2000;
      };
      es.onmessage = (m) => {
        try {
          const ev: AwaazEvent = JSON.parse(m.data);
          if (ev.id <= lastId.current) return;
          lastId.current = ev.id;
          setEvents((prev) => [...prev, ev]);
        } catch {}
      };
      es.onerror = async () => {
        setConnected(false);
        es?.close();
        if (closed) return;
        if (validRef.current) {
          try {
            if (!(await validRef.current())) return; // the owner handles it (new session / sign out)
          } catch {
            // server unreachable: keep retrying with backoff
          }
        }
        if (closed) return;
        retry = setTimeout(open, delay);
        delay = Math.min(delay * 2, 30000);
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
