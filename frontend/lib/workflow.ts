import { AwaazEvent } from "./api";

export type NodeStatus = "idle" | "running" | "waiting" | "done" | "error" | "skipped";

export const NODES: { id: string; label: string; kind: "gate" | "agent" | "human" | "timer"; lane: string }[] = [
  { id: "danger_gate", label: "Danger check", kind: "gate", lane: "start" },
  { id: "location_agent", label: "Location Agent", kind: "agent", lane: "emergency" },
  { id: "twilio_agent", label: "Twilio Agent", kind: "agent", lane: "emergency" },
  { id: "intake_agent", label: "Intake Agent", kind: "agent", lane: "report" },
  { id: "drafting_agent", label: "Drafting Agent", kind: "agent", lane: "report" },
  { id: "user_review", label: "Your review", kind: "human", lane: "report" },
  { id: "police_dispatch_agent", label: "Police Dispatch Agent", kind: "agent", lane: "police" },
  { id: "matching_agent", label: "Matching Agent", kind: "agent", lane: "public" },
  { id: "gmail_communities", label: "Gmail Agent · communities", kind: "agent", lane: "public" },
  { id: "escalation_timer", label: "Escalation timer", kind: "timer", lane: "police" },
  { id: "police_status_agent", label: "Police Status Agent", kind: "agent", lane: "police" },
  { id: "gmail_news", label: "Gmail Agent · news", kind: "agent", lane: "police" },
];

export const EDGES: [string, string][] = [
  ["danger_gate", "location_agent"],
  ["location_agent", "twilio_agent"],
  ["danger_gate", "intake_agent"],
  ["intake_agent", "drafting_agent"],
  ["drafting_agent", "user_review"],
  ["user_review", "police_dispatch_agent"],
  ["user_review", "matching_agent"],
  ["matching_agent", "gmail_communities"],
  ["police_dispatch_agent", "escalation_timer"],
  ["escalation_timer", "police_status_agent"],
  ["police_status_agent", "gmail_news"],
];

export type NodeState = {
  status: NodeStatus;
  fallback?: boolean;
  message?: string;
  dueAt?: string;
  lastTs?: string;
};

const nodeOf = (e: AwaazEvent) => e.node || e.agent || "";

export function deriveNodeStates(events: AwaazEvent[]): Record<string, NodeState> {
  const s: Record<string, NodeState> = {};
  for (const n of NODES) s[n.id] = { status: "idle" };
  const set = (id: string, patch: Partial<NodeState>, ts: string) => {
    if (!s[id]) return;
    s[id] = { ...s[id], ...patch, lastTs: ts };
  };
  for (const e of events) {
    const id = nodeOf(e);
    const d = e.data || {};
    switch (e.kind) {
      case "workflow.start":
        if (d.workflow === "emergency") set("danger_gate", { status: "done" }, e.ts);
        break;
      case "agent.start":
        set(id, { status: "running" }, e.ts);
        break;
      case "agent.end":
        set(id, { status: d.status === "done" ? "done" : "error" }, e.ts);
        break;
      case "tool.start":
        if (s[id]?.status === "idle") set(id, { status: "running" }, e.ts);
        break;
      case "step":
        if (d.fallback) {
          // A fallback means the node still completes, deterministically.
          set(id, { status: "running", fallback: true, message: d.message }, e.ts);
        } else if (d.status) {
          set(id, { status: d.status as NodeStatus, message: d.message, dueAt: d.due_at ?? s[id]?.dueAt }, e.ts);
        }
        break;
      case "outbound":
        if (s[id] && s[id].status !== "error") set(id, { status: s[id].fallback ? "done" : s[id].status }, e.ts);
        break;
      case "status":
        if (id === "location_agent" && d.location) set(id, { status: "done" }, e.ts);
        if (id === "drafting_agent" && d.drafts_ready) set(id, { status: "done" }, e.ts);
        break;
      case "workflow.end":
        if (d.workflow === "emergency") {
          set("location_agent", { status: s.location_agent.status === "error" ? "error" : "done" }, e.ts);
          set("twilio_agent", { status: "done" }, e.ts);
        }
        if (d.workflow === "report") {
          for (const n of ["police_dispatch_agent", "matching_agent", "gmail_communities"])
            if (s[n].status === "running" || s[n].status === "error") set(n, { status: "done" }, e.ts);
        }
        break;
      case "error":
        if (!d.warning && s[id]) set(id, { status: "error", message: d.message }, e.ts);
        break;
    }
  }
  // Agents that failed but whose fallback completed are shown done (with a fallback badge).
  for (const n of NODES) {
    const st = s[n.id];
    if (st.fallback && st.status === "error") st.status = "done";
  }
  if (s.police_dispatch_agent.status === "done" && s.escalation_timer.status === "idle") s.escalation_timer.status = "waiting";
  return s;
}

export type ToolCall = { tool: string; args?: any; result?: any; error?: string; duration_ms?: number; ts: string };

export type AgentCard = {
  node: string;
  agent: string;
  run_id: string;
  model?: string;
  tools: string[];
  calls: ToolCall[];
  messages: string[];
  output?: any;
  status: "running" | "done" | "error";
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  error?: string;
  started: string;
};

export function deriveAgentCards(events: AwaazEvent[]): AgentCard[] {
  const runs = new Map<string, AgentCard>();
  for (const e of events) {
    if (!e.run_id) continue;
    let c = runs.get(e.run_id);
    if (e.kind === "agent.start") {
      c = {
        node: e.node || "",
        agent: e.agent || "",
        run_id: e.run_id,
        model: e.data.model,
        tools: e.data.tools || [],
        calls: [],
        messages: [],
        status: "running",
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        started: e.ts,
      };
      runs.set(e.run_id, c);
      continue;
    }
    if (!c) continue;
    if (e.kind === "tool.start") c.calls.push({ tool: e.data.tool, args: e.data.args, ts: e.ts });
    if (e.kind === "tool.end") {
      const open = [...c.calls].reverse().find((t) => t.tool === e.data.tool && t.result === undefined && !t.error);
      if (open) Object.assign(open, { result: e.data.result, error: e.data.error, duration_ms: e.data.duration_ms });
      else c.calls.push({ tool: e.data.tool, result: e.data.result, error: e.data.error, ts: e.ts });
    }
    if (e.kind === "llm.message") {
      const t = [e.data.text, e.data.action].filter(Boolean).join(" · ");
      if (t) c.messages.push(t);
    }
    if (e.kind === "agent.end") {
      c.status = e.data.status === "done" ? "done" : "error";
      c.output = e.data.output;
      c.tokens_in = e.data.tokens_in || 0;
      c.tokens_out = e.data.tokens_out || 0;
      c.cost_usd = e.data.cost_usd || 0;
      c.error = e.data.error;
    }
  }
  return [...runs.values()];
}

export function fmtCountdown(dueIso: string | undefined, now: number): { text: string; overdue: boolean } {
  if (!dueIso) return { text: "—", overdue: false };
  const ms = new Date(dueIso).getTime() - now;
  const overdue = ms <= 0;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const text = `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return { text: overdue ? `overdue ${text}` : text, overdue };
}
