"use client";

import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentConsole } from "@/components/AgentConsole";
import { Chat } from "@/components/Chat";
import { EventLog } from "@/components/EventLog";
import { SetupDrawer } from "@/components/SetupDrawer";
import { WorkflowGraph } from "@/components/WorkflowGraph";
import { api, ApiError, Health, store } from "@/lib/api";
import { useEvents } from "@/lib/useEvents";
import { deriveAgentCards, deriveNodeStates } from "@/lib/workflow";

const TABS = ["Workflow", "Agents", "Events"] as const;

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Workflow");
  const [focus, setFocus] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const newSession = useCallback(async () => {
    try {
      const r = await api<{ session_id: string }>("/api/sessions", { body: {} });
      store.set("awaaz_session", r.session_id);
      setSessionId(r.session_id);
      setErr(null);
    } catch {
      setErr("Cannot reach the Awaaz server. In an emergency call 15 (Police) or 1122 (Rescue).");
    }
  }, []);

  useEffect(() => {
    const existing = store.get("awaaz_session");
    if (existing) setSessionId(existing);
    else newSession();
    api<Health>("/healthz").then(setHealth).catch(() => {});
  }, [newSession]);

  // If the session was deleted (e.g. after a demo reset), start a new one instead of retrying forever.
  const sessionStillValid = useCallback(async () => {
    if (!sessionId) return false;
    try {
      await api(`/api/sessions/${sessionId}`);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        store.del("awaaz_session");
        newSession();
        return false;
      }
      throw e;
    }
  }, [sessionId, newSession]);

  const { events, connected } = useEvents(sessionId ? `/api/sessions/${sessionId}/events` : null, sessionStillValid);
  const states = useMemo(() => deriveNodeStates(events), [events]);
  const cards = useMemo(() => deriveAgentCards(events), [events]);
  const running = Object.values(states).filter((s) => s.status === "running").length;

  return (
    <div className="mx-auto grid min-h-0 w-full max-w-[1560px] flex-1 gap-3 p-2 sm:p-4 lg:grid-cols-[minmax(360px,520px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-4 lg:overflow-hidden">
      <section className="card flex h-[calc(100dvh-5rem)] min-h-0 flex-col overflow-hidden lg:h-full" aria-label="Chat">
        {err && <p className="m-3 rounded-lg bg-danger-soft p-3 text-sm text-danger">{err}</p>}
        {sessionId && (
          <Chat key={sessionId} sessionId={sessionId} events={events} health={health} onNewSession={newSession} onOpenSetup={() => setSetup(true)} />
        )}
      </section>

      {/* On phones the live system view is a collapsible panel below the chat. */}
      <button className="card flex items-center gap-2 px-4 py-3 text-sm lg:hidden" onClick={() => setShowLive((v) => !v)} aria-expanded={showLive}>
        <Activity size={16} className={running ? "text-run" : "text-muted"} />
        <span className="font-medium">Live system view</span>
        <span className="text-xs text-muted">{running ? `${running} running` : `${cards.length} agent runs`}</span>
        <span className="ml-auto text-muted">{showLive ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>

      <section className={`card min-h-0 flex-col overflow-hidden ${showLive ? "flex h-[80dvh]" : "hidden"} lg:flex lg:h-full`} aria-label="Live system view">
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === t ? "bg-surface-3 font-medium" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {t}
              {t === "Agents" && cards.length > 0 && <span className="ml-1.5 font-mono text-xs text-muted">{cards.length}</span>}
            </button>
          ))}
          <span className={`ml-auto mr-2 inline-flex items-center gap-1.5 text-xs ${connected ? "text-ok" : "text-muted"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-ok" : "bg-line-strong"}`} />
            {connected ? "Live" : "Connecting"}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          {tab === "Workflow" && (
            <WorkflowGraph
              states={states}
              cards={cards}
              onSelect={(id) => {
                setFocus(id);
                setTab("Agents");
              }}
            />
          )}
          {tab === "Agents" && <AgentConsole cards={cards} focus={focus} />}
          {tab === "Events" && <EventLog events={events} />}
        </div>
      </section>

      {sessionId && <SetupDrawer sessionId={sessionId} open={setup} onClose={() => setSetup(false)} />}
    </div>
  );
}
