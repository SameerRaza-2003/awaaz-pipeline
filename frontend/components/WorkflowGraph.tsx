"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, Edge, Handle, MarkerType, MiniMap, Node, NodeProps, Position, ReactFlow } from "@xyflow/react";
import { AlertTriangle, Bot, CheckCircle2, Clock, GitFork, Loader2, MinusCircle, UserRound } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { AgentCard, EDGES, NODES, NodeState, fmtCountdown } from "@/lib/workflow";

const W = 240;
const H = 92;
const GAP = 48;
const PAD = 22;
const LANE_HEAD = 44;

const POS: Record<string, { x: number; y: number }> = {
  danger_gate: { x: 340, y: 0 },
  location_agent: { x: 0, y: 190 },
  twilio_agent: { x: 0, y: 330 },
  intake_agent: { x: 340, y: 190 },
  drafting_agent: { x: 340, y: 330 },
  user_review: { x: 340, y: 470 },
  police_dispatch_agent: { x: 0, y: 700 },
  escalation_timer: { x: 0, y: 840 },
  police_status_agent: { x: 0, y: 980 },
  gmail_news: { x: 0, y: 1120 },
  matching_agent: { x: 340, y: 700 },
  gmail_communities: { x: 340, y: 840 },
  gmail_authority: { x: 680, y: 700 },
};

// Tinted lane panels sit behind the nodes. The lane colour only marks the lane; status colours stay on the nodes.
const LANES = [
  { id: "lane-emergency", label: "Emergency", sub: "if you are in danger", color: "var(--danger)", x: 0, y: 190, rows: 2 },
  { id: "lane-report", label: "Report", sub: "your story, your approval", color: "var(--accent)", x: 340, y: 190, rows: 3 },
  { id: "lane-police", label: "Police", sub: "complaint and escalation", color: "var(--run)", x: 0, y: 700, rows: 4 },
  { id: "lane-public", label: "Public", sub: "activist groups", color: "var(--warn)", x: 340, y: 700, rows: 2 },
  { id: "lane-authority", label: "Authority", sub: "post version", color: "var(--ok)", x: 680, y: 700, rows: 1 },
];
const LANE_COLOR: Record<string, string> = Object.fromEntries(LANES.map((l) => [l.id.replace("lane-", ""), l.color]));
LANE_COLOR.start = "var(--ink-2)";

const TONE: Record<string, { box: string; dot: string; text: string }> = {
  idle: { box: "border-line bg-surface", dot: "bg-line-strong", text: "text-muted" },
  running: { box: "border-run bg-run-soft pulse", dot: "bg-run", text: "text-run" },
  waiting: { box: "border-warn bg-warn-soft", dot: "bg-warn", text: "text-warn" },
  done: { box: "border-ok/60 bg-ok-soft", dot: "bg-ok", text: "text-ok" },
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

const STATUS_ICON = { done: CheckCircle2, error: AlertTriangle, running: Loader2, waiting: Clock, skipped: MinusCircle, idle: null } as const;
const KIND_ICON = { agent: Bot, human: UserRound, timer: Clock, gate: GitFork };

type Data = { label: string; desc: string; lane: string; kind: keyof typeof KIND_ICON; state: NodeState; now: number; tool?: string };

const FlowNode = memo(function FlowNode({ data }: NodeProps<Node<Data>>) {
  const { state, label, desc, lane, kind, now, tool } = data;
  const tone = TONE[state.status];
  const Icon = KIND_ICON[kind];
  const SIcon = STATUS_ICON[state.status];
  const cd = kind === "timer" && state.dueAt && state.status === "waiting" ? fmtCountdown(state.dueAt, now) : null;
  const sub = cd ? cd.text : state.status === "running" && tool ? `${tool}()` : state.message && state.status !== "idle" ? state.message : desc;
  return (
    <div
      className={`relative flex h-full w-full flex-col justify-center overflow-hidden rounded-xl border py-2 pl-5 pr-3 shadow-[var(--shadow)] transition-colors duration-300 ${tone.box}`}
      title={state.message || desc}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: LANE_COLOR[lane] }} aria-hidden />
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-line-strong" />
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3">
          <Icon size={16} className="text-ink-2" aria-hidden />
        </span>
        <span className="truncate text-[15px] font-semibold leading-tight text-ink">{label}</span>
        {state.fallback && (
          <span className="ml-auto shrink-0 rounded border border-warn/50 px-1 text-[10px] font-medium text-warn" title="Completed by the deterministic fallback">
            fallback
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
        {SIcon ? (
          <SIcon size={13} className={`shrink-0 ${tone.text} ${state.status === "running" ? "animate-spin" : ""}`} aria-hidden />
        ) : (
          <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
        )}
        <span className={`shrink-0 font-semibold ${tone.text}`}>{STATUS_TEXT[state.status]}</span>
      </div>
      <div className={`mt-0.5 truncate text-[11.5px] text-muted ${cd ? "font-mono" : ""} ${cd?.overdue ? "!text-danger" : ""}`}>{sub}</div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-line-strong" />
    </div>
  );
});

const LaneNode = memo(function LaneNode({ data }: NodeProps<Node<{ label: string; sub: string; color: string }>>) {
  return (
    <div
      className="h-full w-full rounded-2xl border"
      style={{ background: `color-mix(in srgb, ${data.color} 6%, transparent)`, borderColor: `color-mix(in srgb, ${data.color} 28%, transparent)` }}
    >
      <div className="flex items-baseline gap-2 px-4 pt-2.5">
        <span className="text-[13px] font-bold uppercase tracking-wider" style={{ color: data.color }}>
          {data.label}
        </span>
        <span className="text-[11px] text-muted">{data.sub}</span>
      </div>
    </div>
  );
});

const nodeTypes = { awaaz: FlowNode, lane: LaneNode };

function miniColor(status: string | undefined) {
  if (status === "done") return "var(--ok)";
  if (status === "running") return "var(--run)";
  if (status === "error") return "var(--danger)";
  return "var(--line-strong)";
}

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
        position: { x: l.x - PAD, y: l.y - LANE_HEAD },
        data: { label: l.label, sub: l.sub, color: l.color },
        width: W + PAD * 2,
        height: LANE_HEAD + l.rows * H + (l.rows - 1) * GAP + PAD,
        zIndex: -1,
        draggable: false,
        selectable: false,
      })),
      ...NODES.map((n) => ({
        id: n.id,
        type: "awaaz",
        position: POS[n.id],
        data: { label: n.label, desc: n.desc, lane: n.lane, kind: n.kind, state: states[n.id], now, tool: lastTool[n.id] },
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
        const color = travelled ? "var(--ok)" : moving ? "var(--run)" : "var(--line-strong)";
        return {
          id: `${a}-${b}`,
          source: a,
          target: b,
          type: "smoothstep",
          animated: moving,
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color },
          style: {
            stroke: color,
            strokeWidth: travelled || moving ? 2.5 : 1.5,
            strokeDasharray: sb === "skipped" ? "4 4" : undefined,
          },
        };
      }),
    [states],
  );

  const total = NODES.filter((n) => states[n.id].status !== "skipped").length;
  const done = NODES.filter((n) => states[n.id].status === "done").length;
  const running = NODES.filter((n) => states[n.id].status === "running").length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const summary = running
    ? `${running} agent${running > 1 ? "s" : ""} running now`
    : done === 0
      ? "Waiting for activity"
      : done === total
        ? "All steps complete"
        : "Idle between steps";

  return (
    <div className="relative h-full min-h-[460px] w-full" aria-label="Live workflow graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        nodesConnectable={false}
        onNodeClick={(_, n) => n.type === "awaaz" && onSelect?.(n.id)}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
      >
        <Background gap={22} size={1} color="var(--line)" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          pannable
          zoomable
          position="top-right"
          className="!hidden !rounded-lg !border !border-line !bg-surface xl:!block"
          maskColor="color-mix(in srgb, var(--ink) 8%, transparent)"
          nodeColor={(n) => (n.type === "lane" ? "transparent" : miniColor(states[n.id]?.status))}
        />
      </ReactFlow>
      <div className="pointer-events-none absolute left-3 top-3 w-60 rounded-xl border border-line bg-surface/95 px-3.5 py-2.5 shadow-[var(--shadow)]">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-ink">Workflow progress</span>
          <span className="font-mono text-muted">
            {done}/{total}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-ok transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 text-[11px] text-muted">{summary}</div>
      </div>
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
