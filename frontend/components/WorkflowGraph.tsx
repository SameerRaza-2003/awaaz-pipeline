"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, Edge, Handle, Node, NodeProps, Position, ReactFlow } from "@xyflow/react";
import { memo, useEffect, useMemo, useState } from "react";
import { EDGES, NODES, NodeState, fmtCountdown } from "@/lib/workflow";

const POS: Record<string, { x: number; y: number }> = {
  danger_gate: { x: 300, y: 0 },
  location_agent: { x: 20, y: 120 },
  twilio_agent: { x: 20, y: 240 },
  intake_agent: { x: 470, y: 120 },
  drafting_agent: { x: 470, y: 240 },
  user_review: { x: 470, y: 360 },
  police_dispatch_agent: { x: 300, y: 490 },
  escalation_timer: { x: 300, y: 610 },
  police_status_agent: { x: 300, y: 730 },
  gmail_news: { x: 300, y: 850 },
  matching_agent: { x: 620, y: 490 },
  gmail_communities: { x: 620, y: 610 },
};

const STYLE: Record<string, string> = {
  idle: "border-line bg-surface text-muted",
  running: "border-run bg-run-soft text-ink pulse",
  waiting: "border-warn bg-warn-soft text-ink",
  done: "border-ok bg-ok-soft text-ink",
  error: "border-danger bg-danger-soft text-ink",
  skipped: "border-line border-dashed bg-surface text-muted opacity-70",
};

const STATUS_LABEL: Record<string, string> = {
  idle: "idle",
  running: "running",
  waiting: "waiting",
  done: "done",
  error: "error",
  skipped: "skipped",
};

type Data = { label: string; kind: string; state: NodeState; now: number };

const FlowNode = memo(function FlowNode({ data }: NodeProps<Node<Data>>) {
  const { state, label, kind, now } = data;
  const cd = kind === "timer" && state.dueAt && state.status === "waiting" ? fmtCountdown(state.dueAt, now) : null;
  return (
    <div className={`w-[190px] rounded-xl border-2 px-3 py-2 shadow-sm ${STYLE[state.status]}`} title={state.message || ""}>
      <Handle type="target" position={Position.Top} className="!bg-line !border-0" />
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
        <span>{kind === "agent" ? "agent" : kind === "human" ? "you" : kind === "timer" ? "timer" : "start"}</span>
        <span className="ml-auto font-semibold">{STATUS_LABEL[state.status]}</span>
      </div>
      <div className="font-semibold text-[13px] leading-tight">{label}</div>
      {state.fallback && <div className="mt-1 text-[10px] font-semibold text-warn">deterministic fallback used</div>}
      {cd && <div className={`mt-1 font-mono text-[11px] ${cd.overdue ? "text-danger" : "text-ink-2"}`}>⏱ {cd.text}</div>}
      <Handle type="source" position={Position.Bottom} className="!bg-line !border-0" />
    </div>
  );
});

const nodeTypes = { awaaz: FlowNode };

export function WorkflowGraph({ states, onSelect }: { states: Record<string, NodeState>; onSelect?: (id: string) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const nodes: Node<Data>[] = useMemo(
    () =>
      NODES.map((n) => ({
        id: n.id,
        type: "awaaz",
        position: POS[n.id],
        data: { label: n.label, kind: n.kind, state: states[n.id], now },
        draggable: false,
      })),
    [states, now],
  );

  const edges: Edge[] = useMemo(
    () =>
      EDGES.map(([a, b]) => {
        const sa = states[a]?.status;
        const sb = states[b]?.status;
        const moving = sa === "done" && (sb === "running" || sb === "waiting");
        const travelled = sa === "done" && (sb === "done" || moving);
        return {
          id: `${a}-${b}`,
          source: a,
          target: b,
          animated: moving,
          style: {
            stroke: travelled ? "var(--ok)" : "var(--line)",
            strokeWidth: travelled ? 2.5 : 1.5,
            strokeDasharray: sb === "skipped" ? "4 4" : undefined,
          },
        };
      }),
    [states],
  );

  return (
    <div className="h-full min-h-[480px] w-full" aria-label="Live workflow graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, n) => onSelect?.(n.id)}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
      >
        <Background gap={20} color="var(--line)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
