"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentConsole } from "@/components/AgentConsole";
import { Chat } from "@/components/Chat";
import { EventLog } from "@/components/EventLog";
import { SetupDrawer } from "@/components/SetupDrawer";
import { Welcome } from "@/components/Welcome";
import { WorkflowGraph } from "@/components/WorkflowGraph";
import { WorkflowTimeline } from "@/components/WorkflowTimeline";
import { api, ApiError, auth, Health, store } from "@/lib/api";
import { useEvents } from "@/lib/useEvents";
import { deriveAgentCards, deriveNodeStates } from "@/lib/workflow";

const TABS = ["Workflow", "Agents", "Events"] as const;

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Workflow");
  const [focus, setFocus] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<boolean | null>(null);

  const newSession = useCallback(async () => {
    try {
      const r = await api<{ session_id: string }>("/api/sessions", {
        body: {},
      });
      store.set("awaaz_session", r.session_id);
      setSessionId(r.session_id);
      setErr(null);
    } catch {
      setErr("Awaaz cannot reach its server right now.");
    }
  }, []);

  useEffect(() => {
    setWelcome(!auth.token() && !store.get("awaaz_entered"));
    api<Health>("/healthz")
      .then(setHealth)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (welcome !== false) return;
    const existing = store.get("awaaz_session");
    if (existing) setSessionId(existing);
    else newSession();
  }, [welcome, newSession]);

  const enter = (emergency: boolean) => {
    store.set("awaaz_entered", "1");
    if (emergency) store.set("awaaz_autohelp", "1");
    setWelcome(false);
  };

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

  const { events, connected } = useEvents(
    sessionId ? `/api/sessions/${sessionId}/events` : null,
    sessionStillValid,
  );
  const states = useMemo(() => deriveNodeStates(events), [events]);
  const cards = useMemo(() => deriveAgentCards(events), [events]);
  const running = Object.values(states).filter(
    (s) => s.status === "running",
  ).length;

  if (welcome === null) return null;
  if (welcome)
    return (
      <Welcome
        onContinue={() => enter(false)}
        onEmergency={() => enter(true)}
      />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(22rem,34rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <section
        className="flex h-[calc(100dvh-var(--header-h))] min-h-0 flex-col bg-paper lg:h-full lg:border-r lg:border-line"
        aria-label="Your session"
      >
        {err ? (
          <div
            className="flex flex-1 flex-col justify-center gap-4 px-5 sm:px-8"
            role="alert"
          >
            <h1 className="text-title font-semibold">{err}</h1>
            <p className="text-body text-ink-2">
              If you are in danger, call{" "}
              <a
                className="font-semibold underline underline-offset-4"
                href="tel:15"
              >
                15 (Police)
              </a>{" "}
              or{" "}
              <a
                className="font-semibold underline underline-offset-4"
                href="tel:1122"
              >
                1122 (Rescue)
              </a>
              . Check your connection; this page works again as soon as the
              server is reachable.
            </p>
            <button
              className="btn btn-secondary self-start"
              onClick={newSession}
            >
              Try again
            </button>
          </div>
        ) : (
          sessionId && (
            <Chat
              key={sessionId}
              sessionId={sessionId}
              events={events}
              health={health}
              onNewSession={newSession}
              onOpenSetup={() => setSetup(true)}
            />
          )
        )}
      </section>

      {/* Phones: a stacked timeline below the session, collapsed by default so it never competes with her actions. */}
      <details className="group border-t border-line bg-sunken lg:hidden">
        <summary className="flex min-h-14 list-none items-center gap-3 px-5 text-small">
          <span
            className={`h-2 w-2 rounded-full ${running ? "ping bg-info text-info" : "bg-line-strong"}`}
            aria-hidden
          />
          <span className="font-semibold">How Awaaz is handling this</span>
          <span className="text-muted">
            {running ? `${running} running` : `${cards.length} agent runs`}
          </span>
          <ChevronDown
            size={18}
            strokeWidth={1.75}
            className="ml-auto transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <WorkflowTimeline states={states} cards={cards} />
      </details>

      <section
        className="hidden min-h-0 flex-col bg-sunken lg:flex"
        aria-label="Live system view"
      >
        <div className="flex min-h-14 items-center gap-1 border-b border-line px-4">
          <div
            className="flex items-center gap-1"
            role="tablist"
            aria-label="Live system view"
          >
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                id={`tab-${t}`}
                aria-selected={tab === t}
                aria-controls="live-panel"
                onClick={() => setTab(t)}
                className={`min-h-10 border-b-2 px-3 text-small ${tab === t ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
              >
                {t}
                {t === "Agents" && cards.length > 0 && (
                  <span className="tabular ml-1.5 font-mono text-caption text-muted">
                    {cards.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <span
            className={`ml-auto inline-flex items-center gap-2 text-caption ${connected ? "text-safe-ink" : "text-muted"}`}
            role="status"
          >
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-safe" : "bg-line-strong"}`}
              aria-hidden
            />
            {connected ? "Live" : "Connecting"}
          </span>
        </div>
        <div
          id="live-panel"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          className="min-h-0 flex-1"
        >
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

      {sessionId && (
        <SetupDrawer
          sessionId={sessionId}
          open={setup}
          onClose={() => setSetup(false)}
        />
      )}
    </div>
  );
}
