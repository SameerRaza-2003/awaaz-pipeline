"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, Edge, Handle, Node, NodeProps, Position, ReactFlow } from "@xyflow/react";
import { Bot, Clock, GitFork, UserRound } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { AgentCard, EDGES, NODES, NodeState, fmtCountdown } from "@/lib/workflow";

const W = 210;
const H = 74;

const POS: Record<string, { x: number; y: number }> = {
  danger_gate: { x: 255, y: 0 },
  location_agent: { x: 0, y: 140 },
  twilio_agent: { x: 0, y: 260 },
  intake_agent: { x: 510, y: 140 },
  drafting_agent: { x: 510, y: 260 },
  user_review: { x: 510, y: 380 },
  police_dispatch_agent: { x: 330, y: 540 },
  escalation_timer: { x: 330, y: 660 },
  police_status_agent: { x: 330, y: 780 },
  gmail_news: { x: 330, y: 900 },
  matching_agent: { x: 690, y: 540 },
  gmail_communities: { x: 690, y: 660 },
};

const LANES = [
  { id: "lane-emergency", label: "Emergency", x: 0, y: 108 },
  { id: "lane-report", label: "Report", x: 510, y: 108 },
  { id: "lane-police", label: "Police", x: 330, y: 508 },
  { id: "lane-public", label: "Public", x: 690, y: 508 },
];

const TONE: Record<string, { box: string; dot: string; text: string }> = {
  idle: { box: "border-line bg-surface", dot: "bg-line-strong", text: "text-muted" },
  running: { box: "border-run bg-run-soft pulse", dot: "bg-run", text: "text-run" },
  waiting: { box: "border-warn bg-warn-soft", dot: "bg-warn", text: "text-warn" },
  done: { box: "border-ok/60 bg-surface", dot: "bg-ok", text: "text-ok" },
  error: { box: "border-danger bg-danger-soft", dot: "bg-danger", text: "text-danger" },
  skipped: { box: "border-dashed border-line-strong bg-surface opacity-60", dot: "bg-line-strong", text: "text-muted" },
};

const STATUS_TEXT: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  waiting: "Waiting",
  done: "Done",
  error: "Error",
  skipped: "Skipped",
};

const KIND_ICON = { agent: Bot, human: UserRound, timer: Clock, gate: GitFork };

type Data = { label: string; kind: keyof typeof KIND_ICON; state: NodeState; now: number; tool?: string };

const FlowNode = memo(function FlowNode({ data }: NodeProps<Node<Data>>) {
  const { state, label, kind, now, tool } = data;
  const tone = TONE[state.status];
  const Icon = KIND_ICON[kind];
  const cd = kind === "timer" && state.dueAt && state.status === "waiting" ? fmtCountdown(state.dueAt, now) : null;
  const sub = cd ? cd.text : state.status === "running" && tool ? `${tool}()` : state.message && state.status !== "idle" ? state.message : null;
  return (
    <div className={`flex h-full w-full flex-col justify-center rounded-xl border px-3 shadow-[var(--shadow)] ${tone.box}`} title={state.message || ""}>
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />
      <div className="flex items-center gap-2">
        <Icon size={14} className="shrink-0 text-ink-2" aria-hidden />
        <span className="truncate text-[13px] font-medium text-ink">{label}</span>
        {state.fallback && (
          <span className="ml-auto shrink-0 rounded border border-warn/50 px-1 text-[10px] font-medium text-warn" title="Completed by the deterministic fallback">
            fallback
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
        <span className={`shrink-0 font-medium ${tone.text}`}>{STATUS_TEXT[state.status]}</span>
        {sub && <span className={`truncate text-muted ${cd ? "font-mono" : ""} ${cd?.overdue ? "!text-danger" : ""}`}>· {sub}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />
    </div>
  );
});

const LaneNode = memo(function LaneNode({ data }: NodeProps<Node<{ label: string }>>) {
  return <div className="label">{data.label}</div>;
});

const nodeTypes = { awaaz: FlowNode, lane: LaneNode };

export function WorkflowGraph({
  states,
  cards,
  onSelect,
}: {
  states: Record<string, NodeState>;
  cards: AgentCard[];
  onSelect?: (id: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Latest tool each node is calling, from the agent runs.
  const lastTool = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of cards) {
      const t = c.calls[c.calls.length - 1];
      if (t) m[c.node] = t.tool;
    }
    return m;
  }, [cards]);

  const nodes: Node[] = useMemo(
    () => [
      ...LANES.map((l) => ({
        id: l.id,
        type: "lane",
        position: { x: l.x, y: l.y },
        data: { label: l.label },
        width: W,
        height: 20,
        draggable: false,
        selectable: false,
      })),
      ...NODES.map((n) => ({
        id: n.id,
        type: "awaaz",
        position: POS[n.id],
        data: { label: n.label, kind: n.kind, state: states[n.id], now, tool: lastTool[n.id] },
        // Fixed size: nodes are rebuilt every render, so React Flow must not depend on DOM measurement.
        width: W,
        height: H,
        draggable: false,
      })),
    ],
    [states, now, lastTool],
  );

  const edges: Edge[] = useMemo(
    () =>
      EDGES.map(([a, b]) => {
        const sa = states[a]?.status;
        const sb = states[b]?.status;
        const moving = sa === "done" && (sb === "running" || sb === "waiting");
        const travelled = sa === "done" && sb !== "idle" && sb !== "skipped";
        return {
          id: `${a}-${b}`,
          source: a,
          target: b,
          animated: moving,
          style: {
            stroke: travelled ? "var(--ok)" : "var(--line-strong)",
            strokeWidth: travelled ? 2 : 1.25,
            strokeDasharray: sb === "skipped" ? "4 4" : undefined,
          },
        };
      }),
    [states],
  );

  return (
    <div className="relative h-full min-h-[460px] w-full" aria-label="Live workflow graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        nodesConnectable={false}
        onNodeClick={(_, n) => n.type === "awaaz" && onSelect?.(n.id)}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
      >
        <Background gap={22} size={1} color="var(--line)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line bg-surface/90 px-3 py-2 text-[11px] text-ink-2">
        {(["running", "waiting", "done", "error", "skipped"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${TONE[s].dot}`} />
            {STATUS_TEXT[s]}
          </span>
        ))}
        <span className="text-muted">Click an agent for its tool calls</span>
      </div>
    </div>
  );
}
