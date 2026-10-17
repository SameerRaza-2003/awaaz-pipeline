"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, Edge, Handle, MarkerType, Node, NodeProps, Position, ReactFlow } from "@xyflow/react";
import { Bot, Clock, GitFork, UserRound } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { STATE_LABEL, StatusMark } from "@/components/WorkflowStatus";
import { AgentCard, EDGES, NODES, NodeState, fmtCountdown } from "@/lib/workflow";

const W = 236;
const H = 78;
const GAP = 26;
const PAD = 16;
const LANE_HEAD = 34;

const COL = [0, 300, 600];
const TOP = 140; // first row of the Emergency and Report lanes
const BOTTOM = TOP + 3 * (H + GAP) + 50; // first row of the Authorities, Public and Communities lanes
const row = (base: number, i: number) => base + i * (H + GAP);

const POS: Record<string, { x: number; y: number }> = {
  danger_gate: { x: COL[1], y: 0 },
  location_agent: { x: COL[0], y: row(TOP, 0) },
  alert_agent: { x: COL[0], y: row(TOP, 1) },
  intake_agent: { x: COL[1], y: row(TOP, 0) },
  drafting_agent: { x: COL[1], y: row(TOP, 1) },
  user_review: { x: COL[1], y: row(TOP, 2) },
  police_dispatch_agent: { x: COL[0], y: row(BOTTOM, 0) },
  escalation_timer: { x: COL[0], y: row(BOTTOM, 1) },
  police_status_agent: { x: COL[0], y: row(BOTTOM, 2) },
  gmail_news: { x: COL[0], y: row(BOTTOM, 3) },
  matching_agent: { x: COL[1], y: row(BOTTOM, 0) },
  gmail_communities: { x: COL[1], y: row(BOTTOM, 1) },
  gmail_authority: { x: COL[2], y: row(BOTTOM, 0) },
};

// Lanes are grouping only: an outline and a label, no colour.
const LANES = [
  { id: "lane-emergency", label: "Emergency", sub: "if she is in danger", x: COL[0], y: TOP, rows: 2 },
  { id: "lane-report", label: "Report", sub: "her account, her approval", x: COL[1], y: TOP, rows: 3 },
  { id: "lane-police", label: "Authorities", sub: "complaint", x: COL[0], y: BOTTOM, rows: 4 },
  { id: "lane-public", label: "Public", sub: "activist groups", x: COL[1], y: BOTTOM, rows: 2 },
  { id: "lane-authority", label: "Communities", sub: "post version", x: COL[2], y: BOTTOM, rows: 1 },
];

const KIND_ICON = { agent: Bot, human: UserRound, timer: Clock, gate: GitFork };

const BOX: Record<string, string> = {
  idle: "border-line bg-surface",
  running: "border-info bg-info-soft",
  waiting: "border-hold bg-hold-soft",
  done: "border-line-strong bg-surface",
  error: "border-danger bg-danger-soft",
  skipped: "border-dashed border-line bg-paper",
};

type Data = { label: string; desc: string; kind: keyof typeof KIND_ICON; state: NodeState; now: number; tool?: string };

const FlowNode = memo(function FlowNode({ data }: NodeProps<Node<Data>>) {
  const { state, label, desc, kind, now, tool } = data;
  const Icon = KIND_ICON[kind];
  const cd = kind === "timer" && state.dueAt && state.status === "waiting" ? fmtCountdown(state.dueAt, now) : null;
  const sub = cd ? cd.text : state.status === "running" && tool ? `${tool}()` : state.message && state.status !== "idle" ? state.message : desc;
  const mono = !!cd || (state.status === "running" && !!tool);
  return (
    <div
      className={`flex h-full w-full flex-col justify-center rounded-md border px-3.5 transition-colors duration-200 ${BOX[state.status]} ${
        state.status === "skipped" ? "opacity-70" : ""
      }`}
      title={state.message || desc}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />
      <div className="flex items-center gap-2">
        <Icon size={16} strokeWidth={1.75} className="shrink-0 text-ink-2" aria-hidden />
        <span className="truncate text-small font-semibold leading-tight text-ink">{label}</span>
        {state.fallback && (
          <span className="chip ml-auto shrink-0 border border-hold text-hold" title="Completed by the deterministic fallback">
            fallback
          </span>
        )}
      </div>
      <div className="mt-1">
        <StatusMark status={state.status} />
      </div>
      <div className={`mt-0.5 truncate text-caption text-muted ${mono ? "tabular font-mono" : ""} ${cd?.overdue ? "!text-danger-ink" : ""}`}>{sub}</div>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />
    </div>
  );
});

const LaneNode = memo(function LaneNode({ data }: NodeProps<Node<{ label: string; sub: string }>>) {
  return (
    <div className="h-full w-full rounded-lg border border-line">
      <div className="flex items-baseline gap-2 px-4 pt-2.5">
        <span className="label !text-ink-2">{data.label}</span>
        <span className="text-caption text-muted">{data.sub}</span>
      </div>
    </div>
  );
});

const nodeTypes = { awaaz: FlowNode, lane: LaneNode };

export function WorkflowGraph({ states, cards, onSelect }: { states: Record<string, NodeState>; cards: AgentCard[]; onSelect?: (id: string) => void }) {
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
        data: { label: l.label, sub: l.sub },
        width: W + PAD * 2,
        height: LANE_HEAD + l.rows * H + (l.rows - 1) * GAP + PAD,
        zIndex: -1,
        draggable: false,
        selectable: false,
        focusable: false,
      })),
      ...NODES.map((n) => ({
        id: n.id,
        type: "awaaz",
        position: POS[n.id],
        data: { label: n.label, desc: n.desc, kind: n.kind, state: states[n.id], now, tool: lastTool[n.id] },
        // Fixed size: nodes are rebuilt every render, so React Flow must not depend on DOM measurement.
        width: W,
        height: H,
        draggable: false,
        ariaLabel: `${n.label}: ${STATE_LABEL[states[n.id].status]}`,
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
        const color = moving ? "var(--info)" : travelled ? "var(--ink-2)" : "var(--line-strong)";
        return {
          id: `${a}-${b}`,
          source: a,
          target: b,
          type: "smoothstep",
          animated: moving,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
          style: { stroke: color, strokeWidth: travelled || moving ? 2 : 1.25, strokeDasharray: sb === "skipped" ? "4 4" : undefined },
        };
      }),
    [states],
  );

  const total = NODES.filter((n) => states[n.id].status !== "skipped").length;
  const done = NODES.filter((n) => states[n.id].status === "done").length;
  const running = NODES.filter((n) => states[n.id].status === "running");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line px-4 py-2.5 text-small">
        <span className="tabular font-semibold">
          {done} of {total} steps done
        </span>
        <span className="text-ink-2" aria-live="polite">
          {running.length ? `Running: ${running.map((n) => n.label).join(", ")}` : done === 0 ? "Waiting for activity" : "Idle between steps"}
        </span>
        <span className="ml-auto text-caption text-muted">Select an agent to see its tool calls</span>
      </div>
      <div className="relative min-h-0 flex-1" aria-label="Live workflow graph">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.04 }}
          nodesConnectable={false}
          onNodeClick={(_, n) => n.type === "awaaz" && onSelect?.(n.id)}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
        >
          <Background gap={24} size={1} color="var(--line)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    </div>
  );
}
