"use client";

import { useMemo, useState } from "react";
import { AwaazEvent } from "@/lib/api";

const KINDS = ["agent.start", "agent.end", "tool.start", "tool.end", "llm.message", "step", "outbound", "status", "error", "workflow.start", "workflow.end"];

const COLOR: Record<string, string> = {
  error: "text-danger",
  outbound: "text-ok",
  "tool.start": "text-run",
  "tool.end": "text-run",
  "agent.start": "text-accent",
  "agent.end": "text-accent",
};

export function EventLog({ events }: { events: AwaazEvent[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const shown = useMemo(
    () =>
      events.filter(
        (e) => !hidden.has(e.kind) && (!q || JSON.stringify(e).toLowerCase().includes(q.toLowerCase())),
      ),
    [events, hidden, q],
  );
  const toggle = (k: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-line p-2">
        <input className="field !py-1.5 text-sm" placeholder="Filter text…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => toggle(k)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${hidden.has(k) ? "border-line text-muted line-through" : "border-accent text-accent"}`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto font-mono text-[11px]">
        {shown.length === 0 && <p className="p-3 font-sans text-sm text-muted">No events yet.</p>}
        {shown.map((e) => (
          <div key={e.id} className="border-b border-line px-2 py-1.5">
            <span className="text-muted">#{e.id} {e.ts.slice(11, 19)}</span>{" "}
            <span className={`font-semibold ${COLOR[e.kind] || ""}`}>{e.kind}</span>{" "}
            <span className="text-ink-2">{e.node || e.agent || ""}</span>
            <div className="break-words text-ink-2">{JSON.stringify(e.data)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
