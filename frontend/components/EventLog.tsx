"use client";

import { useMemo, useState } from "react";
import { AwaazEvent } from "@/lib/api";

const GROUPS: Record<string, string[]> = {
  Agents: ["agent.start", "agent.end", "llm.message"],
  Tools: ["tool.start", "tool.end"],
  Messages: ["outbound"],
  Workflow: ["step", "status", "workflow.start", "workflow.end"],
  Errors: ["error"],
};

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
  const shown = useMemo(() => {
    const hiddenKinds = new Set([...hidden].flatMap((g) => GROUPS[g]));
    return events.filter((e) => !hiddenKinds.has(e.kind) && (!q || JSON.stringify(e).toLowerCase().includes(q.toLowerCase())));
  }, [events, hidden, q]);

  const toggle = (g: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
        <input className="field !w-48 !py-1.5 text-sm" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
        {Object.keys(GROUPS).map((g) => (
          <button
            key={g}
            onClick={() => toggle(g)}
            aria-pressed={!hidden.has(g)}
            className={`rounded-md border px-2 py-1 text-xs ${hidden.has(g) ? "border-line text-muted" : "border-line-strong bg-surface-2 text-ink"}`}
          >
            {g}
          </button>
        ))}
        <span className="ml-auto font-mono text-xs text-muted">{shown.length} events</span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto font-mono text-[11px]">
        {shown.length === 0 && <p className="p-4 font-sans text-sm text-muted">No events yet.</p>}
        {shown.map((e) => (
          <div key={e.id} className="grid grid-cols-[4.5rem_6.5rem_1fr] gap-x-3 border-b border-line px-3 py-1.5">
            <span className="text-muted">{e.ts.slice(11, 19)}</span>
            <span className={`font-medium ${COLOR[e.kind] || "text-ink-2"}`}>{e.kind}</span>
            <span className="min-w-0">
              <span className="text-ink">{e.node || e.agent || ""}</span>
              <span className="block break-words text-muted">{JSON.stringify(e.data)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
