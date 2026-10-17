"use client";

import { StatusMark } from "@/components/WorkflowStatus";
import { AgentCard, NODES, NodeState } from "@/lib/workflow";

const LANE_LABEL: Record<string, string> = {
  start: "Start",
  emergency: "Emergency",
  report: "Report",
  police: "Authorities",
  public: "Public",
  authority: "Communities",
};

/**
 * The live workflow for small screens: a stacked list grouped by lane, with each agent's latest tool call.
 * Steps that have not started are folded away so the list stays short.
 */
export function WorkflowTimeline({ states, cards }: { states: Record<string, NodeState>; cards: AgentCard[] }) {
  const lastCall: Record<string, string> = {};
  for (const c of cards) {
    const t = c.calls[c.calls.length - 1];
    if (t) lastCall[c.node] = t.tool;
  }
  const lanes = [...new Set(NODES.map((n) => n.lane))];
  const active = NODES.filter((n) => states[n.id].status !== "idle");

  if (active.length === 0) return <p className="px-5 pb-5 text-small text-muted">Nothing has run yet. Each step will appear here as it happens.</p>;

  return (
    <div className="space-y-4 px-5 pb-6">
      {lanes.map((lane) => {
        const nodes = NODES.filter((n) => n.lane === lane && states[n.id].status !== "idle");
        if (!nodes.length) return null;
        return (
          <section key={lane} aria-label={LANE_LABEL[lane]}>
            <h3 className="label">{LANE_LABEL[lane]}</h3>
            <ol className="mt-1 divide-y divide-line border-y border-line">
              {nodes.map((n) => {
                const s = states[n.id];
                return (
                  <li key={n.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-small font-semibold">{n.label}</p>
                      <p className="truncate text-caption text-muted">
                        {s.status === "running" && lastCall[n.id] ? <span className="font-mono">{lastCall[n.id]}()</span> : s.message || n.desc}
                      </p>
                    </div>
                    <StatusMark status={s.status} />
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
