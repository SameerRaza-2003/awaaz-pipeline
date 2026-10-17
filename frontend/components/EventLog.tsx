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

const TONE: Record<string, string> = {
  error: "text-danger-ink",
  outbound: "text-safe-ink",
  "tool.start": "text-info",
  "tool.end": "text-info",
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
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <label className="sr-only" htmlFor="event-filter">
          Filter events
        </label>
        <input id="event-filter" className="field !min-h-10 !w-48 !py-1.5 text-small" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
        {Object.keys(GROUPS).map((g) => (
          <button
            key={g}
            onClick={() => toggle(g)}
            aria-pressed={!hidden.has(g)}
            className={`min-h-10 rounded-sm border px-2.5 text-caption font-semibold ${
              hidden.has(g) ? "border-line text-muted line-through" : "border-line-strong bg-surface text-ink"
            }`}
          >
            {g}
          </button>
        ))}
        <span className="tabular ml-auto font-mono text-caption text-muted" aria-live="polite">
          {shown.length} events
        </span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto font-mono text-caption" tabIndex={0} aria-label="Event log">
        {shown.length === 0 ? (
          <p className="p-5 font-sans text-small text-muted">No events yet.</p>
        ) : (
          <table className="w-full border-collapse">
            <caption className="sr-only">Raw event stream, oldest first</caption>
            <thead className="sticky top-0 bg-sunken text-left">
              <tr className="border-b border-line">
                <th scope="col" className="label px-4 py-2 font-sans">
                  Time
                </th>
                <th scope="col" className="label px-2 py-2 font-sans">
                  Kind
                </th>
                <th scope="col" className="label px-2 py-2 font-sans">
                  Node and data
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className="border-b border-line align-top">
                  <td className="tabular whitespace-nowrap px-4 py-1.5 text-muted">{e.ts.slice(11, 19)}</td>
                  <td className={`whitespace-nowrap px-2 py-1.5 font-semibold ${TONE[e.kind] || "text-ink-2"}`}>{e.kind}</td>
                  <td className="px-2 py-1.5 [overflow-wrap:anywhere]">
                    <span className="text-ink">{e.node || e.agent || ""}</span>
                    <span className="block text-muted">{JSON.stringify(e.data)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
