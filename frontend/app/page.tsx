"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentConsole } from "@/components/AgentConsole";
import { Chat } from "@/components/Chat";
import { EventLog } from "@/components/EventLog";
import { SetupDrawer } from "@/components/SetupDrawer";
import { WorkflowGraph } from "@/components/WorkflowGraph";
import { api, Health, store } from "@/lib/api";
import { useEvents } from "@/lib/useEvents";
import { deriveAgentCards, deriveNodeStates } from "@/lib/workflow";

const TABS = ["Workflow", "Agent Console", "Event Log"] as const;

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

  const { events, connected } = useEvents(sessionId ? `/api/sessions/${sessionId}/events` : null);
  const states = useMemo(() => deriveNodeStates(events), [events]);
  const cards = useMemo(() => deriveAgentCards(events), [events]);

  return (
    <div className="mx-auto grid w-full max-w-[1500px] flex-1 gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(340px,1fr)_minmax(0,1.25fr)]">
      <section className="card flex min-h-[70vh] flex-col overflow-hidden lg:h-[calc(100vh-8rem)]" aria-label="Chat">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <h1 className="font-semibold">Awaaz</h1>
          <span className="text-xs text-muted">private · anonymous session</span>
          <button className="ml-auto btn btn-ghost !min-h-9 !py-1 text-sm" onClick={() => setSetup(true)} disabled={!sessionId}>
            ⚙ Setup
          </button>
          <button className="btn btn-ghost !min-h-9 !py-1 text-sm lg:hidden" onClick={() => setShowLive((v) => !v)}>
            {showLive ? "Hide" : "Live"} workflow
          </button>
        </div>
        {err && <p className="m-3 rounded-lg bg-danger-soft p-2 text-sm text-danger">{err}</p>}
        {sessionId && (
          <Chat
            key={sessionId}
            sessionId={sessionId}
            events={events}
            health={health}
            onNewSession={newSession}
            onOpenSetup={() => setSetup(true)}
          />
        )}
      </section>

      <section
        className={`card flex min-h-[70vh] flex-col overflow-hidden lg:flex lg:h-[calc(100vh-8rem)] ${showLive ? "flex" : "hidden"}`}
        aria-label="Live workflow"
      >
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-2 text-sm ${tab === t ? "bg-surface-2 font-semibold" : "text-ink-2"}`}
            >
              {t}
            </button>
          ))}
          <span className={`ml-auto mr-2 text-xs ${connected ? "text-ok" : "text-muted"}`}>{connected ? "● live" : "○ connecting"}</span>
        </div>
        <div className="min-h-0 flex-1">
          {tab === "Workflow" && (
            <WorkflowGraph
              states={states}
              onSelect={(id) => {
                setFocus(id);
                setTab("Agent Console");
              }}
            />
          )}
          {tab === "Agent Console" && <AgentConsole cards={cards} focus={focus} />}
          {tab === "Event Log" && <EventLog events={events} />}
        </div>
      </section>

      {sessionId && <SetupDrawer sessionId={sessionId} open={setup} onClose={() => setSetup(false)} />}
    </div>
  );
}
