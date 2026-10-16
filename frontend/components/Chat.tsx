"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, AwaazEvent, Health, Receipt, SessionInfo } from "@/lib/api";
import { fmtCountdown } from "@/lib/workflow";

type Props = {
  sessionId: string;
  events: AwaazEvent[];
  health: Health | null;
  onNewSession: () => void;
  onOpenSetup: () => void;
};

type Msg = { role: "user" | "assistant" | "system"; text: string };

function Bubble({ m }: { m: Msg }) {
  const mine = m.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        dir="auto"
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
          mine ? "bg-accent text-accent-ink rounded-br-sm" : m.role === "system" ? "bg-warn-soft text-ink" : "bg-surface border border-line rounded-bl-sm"
        }`}
        style={{ fontFamily: /[؀-ۿ]/.test(m.text) ? "var(--font-urdu), var(--font-sans-stack)" : undefined }}
      >
        {m.text}
      </div>
    </div>
  );
}

function Chip({ ok, active, children }: { ok?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
        ok ? "bg-ok-soft text-ok" : active ? "bg-run-soft text-run" : "bg-surface-2 text-muted"
      }`}
    >
      {ok ? "✓" : active ? "…" : "○"} {children}
    </span>
  );
}

export function Chat({ sessionId, events, health, onNewSession, onOpenSetup }: Props) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [local, setLocal] = useState<Msg[]>([]);
  const [dangerPrompt, setDangerPrompt] = useState(false);
  const [locDenied, setLocDenied] = useState<{ seconds: number } | null>(null);
  const [locText, setLocText] = useState("");
  const [policeText, setPoliceText] = useState("");
  const [revise, setRevise] = useState<{ target: "public" | "police"; text: string } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const watchId = useRef<number | null>(null);
  const lastPost = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api<SessionInfo>(`/api/sessions/${sessionId}`);
      setSession(s);
      if (s.drafts) setPoliceText((p) => p || s.drafts!.police_text);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) onNewSession();
    }
  }, [sessionId, onNewSession]);

  useEffect(() => {
    setLocal([]);
    setPoliceText("");
    setCancelled(false);
    refresh();
  }, [sessionId, refresh]);

  // Refresh server state when the workflow reaches a checkpoint.
  const lastEvent = events[events.length - 1];
  useEffect(() => {
    if (!lastEvent) return;
    const d = lastEvent.data || {};
    if (d.drafts_ready || d.receipt || d.purged || (lastEvent.kind === "step" && lastEvent.node === "user_review")) {
      setPoliceText("");
      refresh();
    }
    if (d.danger_suspected) setDangerPrompt(true);
  }, [lastEvent, refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.transcript.length, local.length, busy, session?.phase]);

  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    },
    [],
  );

  const phase = session?.phase ?? "loading";

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ---------- emergency ----------
  const startTracking = () => {
    if (!navigator.geolocation || watchId.current !== null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const t = Date.now();
        if (t - lastPost.current < 15000) return;
        lastPost.current = t;
        api(`/api/sessions/${sessionId}/location`, {
          body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy },
        }).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
  };

  const sendDanger = async (location?: { lat: number; lng: number; accuracy: number }, text?: string) => {
    await api(`/api/sessions/${sessionId}/danger`, { body: { answer: "yes", location, location_text: text || undefined } });
    lastPost.current = Date.now();
    startTracking();
    await refresh();
  };

  const onDangerYes = () =>
    run(async () => {
      setDangerPrompt(false);
      const pos = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
      });
      if (pos) {
        await sendDanger({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      } else {
        setLocDenied({ seconds: 10 });
      }
    });

  // Without location, the alert still goes out after a short countdown (fail open on help).
  useEffect(() => {
    if (!locDenied) return;
    if (locDenied.seconds <= 0) {
      setLocDenied(null);
      run(() => sendDanger(undefined, locText));
      return;
    }
    const t = setTimeout(() => setLocDenied((l) => (l ? { seconds: l.seconds - 1 } : l)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locDenied]);

  const onSafe = () =>
    run(async () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      await api(`/api/sessions/${sessionId}/safe`, { body: {} });
      await refresh();
    });

  const emergency = useMemo(() => {
    let location: any = null;
    let sms: any = null;
    let call: any = null;
    let discord: any = null;
    let started = false;
    let finished = false;
    let warning: string | null = null;
    let updates = 0;
    for (const e of events) {
      if (e.kind === "workflow.start" && e.data.workflow === "emergency") started = true;
      if (e.kind === "status" && e.data.location) location = e.data.location;
      if (e.kind === "outbound" && e.data.kind === "sms") {
        if (!sms) sms = e.data;
        else updates += 1;
      }
      if (e.kind === "outbound" && e.data.kind === "call" && !call) call = e.data;
      if (e.kind === "outbound" && e.data.kind === "discord" && !discord && e.agent !== "setup") discord = e.data;
      if (e.kind === "workflow.end" && e.data.workflow === "emergency") finished = true;
      if ((e.kind === "error" || e.kind === "status") && e.data.warning) warning = e.data.message;
    }
    return { location, sms, call, discord, started, finished, warning, updates };
  }, [events]);

  // ---------- report ----------
  const onNo = () => run(async () => {
    await api(`/api/sessions/${sessionId}/danger`, { body: { answer: "no" } });
    await refresh();
  });

  const onReport = (yes: boolean) =>
    run(async () => {
      await api(`/api/sessions/${sessionId}/report/start`, { body: { wants_report: yes } });
      await refresh();
    });

  const onSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setLocal((l) => [...l, { role: "user", text }]);
    run(async () => {
      const r = await api<{ reply: string; finalized: boolean; danger_suspected: boolean }>(`/api/sessions/${sessionId}/messages`, { body: { text } });
      if (r.danger_suspected) setDangerPrompt(true);
      setLocal([]);
      await refresh();
    }).catch(() => {});
  };

  const onRevise = () =>
    run(async () => {
      if (!revise?.text.trim()) return;
      await api(`/api/sessions/${sessionId}/report/revise`, { body: { target: revise.target, instruction: revise.text } });
      setRevise(null);
      await refresh();
    });

  const onConfirm = () =>
    run(async () => {
      const edited = session?.drafts && policeText !== session.drafts.police_text ? policeText : undefined;
      await api(`/api/sessions/${sessionId}/report/confirm`, { body: { police_text: edited } });
      await refresh();
    });

  const receipt: Receipt | null = useMemo(() => {
    let r: Receipt | null = session?.receipt ?? null;
    for (const e of events) if (e.kind === "status" && e.data.receipt) r = e.data.receipt;
    return r;
  }, [events, session?.receipt]);

  const dueAt = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i].node === "escalation_timer" && events[i].data.due_at) return events[i].data.due_at as string;
    return receipt?.escalation_due_at ?? undefined;
  }, [events, receipt]);

  const escalationOutcome = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.node === "police_status_agent" && e.kind === "status" && "escalated" in e.data) return e.data.reason as string;
      if (e.node === "escalation_timer" && e.data.status === "skipped") return e.data.message as string;
    }
    return null;
  }, [events]);

  const onCancel = () =>
    run(async () => {
      if (!receipt) return;
      await api(`/api/complaints/${receipt.public_ref}/cancel-escalation`, { body: {} });
      setCancelled(true);
    });

  const onFastForward = () =>
    run(async () => {
      if (!receipt) return;
      await api(`/api/demo/fast-forward/${receipt.public_ref}`, { body: {} });
    });

  const transcript: Msg[] = [...(session?.transcript ?? []), ...local];
  const drafting = phase === "drafting";

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {/* Gate */}
        <Bubble m={{ role: "assistant", text: "Are you in danger right now?" }} />
        {phase === "gate" && (
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-danger text-lg !py-4" disabled={busy} onClick={onDangerYes}>
              Yes
            </button>
            <button className="btn btn-ghost text-lg !py-4" disabled={busy} onClick={onNo}>
              No
            </button>
          </div>
        )}

        {locDenied && (
          <div className="card space-y-2 border-warn p-3">
            <p className="font-semibold">We couldn&apos;t get your location.</p>
            <p className="text-sm text-ink-2">Type where you are (optional). The alert goes out in {locDenied.seconds}s either way.</p>
            <input className="field" dir="auto" placeholder="e.g. near Liberty Market, Gulberg" value={locText} onChange={(e) => setLocText(e.target.value)} />
            <button className="btn btn-danger w-full" onClick={() => setLocDenied({ seconds: 0 })}>
              Send alert now
            </button>
          </div>
        )}

        {/* Emergency */}
        {(phase === "emergency" || phase === "safe" || emergency.started) && (
          <div className="space-y-3">
            <Bubble m={{ role: "user", text: "Yes" }} />
            <div className="card space-y-3 p-3">
              <div className="flex flex-wrap gap-2">
                <Chip ok={!!emergency.location?.location_available} active={!emergency.location}>
                  {emergency.location ? (emergency.location.location_available ? "Location found" : "Location unavailable") : "Finding location"}
                </Chip>
                {(emergency.sms || !emergency.finished) && (
                  <Chip ok={!!emergency.sms && emergency.sms.status !== "failed"} active={!emergency.sms}>
                    {emergency.sms ? `SMS ${emergency.sms.status === "dry_run" ? "sent (dry run)" : emergency.sms.status}` : "Sending SMS"}
                  </Chip>
                )}
                {(emergency.call || !emergency.finished) && (
                  <Chip ok={!!emergency.call && emergency.call.status !== "failed"} active={!emergency.call}>
                    {emergency.call ? `Call ${emergency.call.status === "dry_run" ? "placed (dry run)" : emergency.call.status}` : "Calling your contact…"}
                  </Chip>
                )}
                {emergency.discord && (
                  <Chip ok={emergency.discord.status !== "failed"}>
                    Discord {emergency.discord.status === "dry_run" ? "posted (dry run)" : emergency.discord.status}
                  </Chip>
                )}
                {emergency.updates > 0 && <Chip ok>{emergency.updates} location update(s)</Chip>}
              </div>
              {emergency.warning && (
                <p className="rounded-lg bg-warn-soft p-2 text-sm text-warn">
                  {emergency.warning}{" "}
                  <button className="underline" onClick={onOpenSetup}>
                    Open setup
                  </button>
                </p>
              )}
              {emergency.location?.location_available && (
                <>
                  <iframe
                    title="Your location"
                    className="h-56 w-full rounded-lg border border-line"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    src={
                      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
                        ? `https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${emergency.location.lat},${emergency.location.lng}&zoom=16`
                        : `https://maps.google.com/maps?q=${emergency.location.lat},${emergency.location.lng}&z=16&output=embed`
                    }
                  />
                  <a className="text-sm text-run underline break-all" href={emergency.location.maps_link} target="_blank" rel="noreferrer">
                    {emergency.location.address || emergency.location.maps_link}
                  </a>
                  {emergency.location.address_source === "openstreetmap" && (
                    <p className="text-[11px] text-muted">Address © OpenStreetMap contributors</p>
                  )}
                </>
              )}
              {phase === "emergency" && (
                <button className="btn btn-primary w-full text-lg !py-4" disabled={busy} onClick={onSafe}>
                  I&apos;m safe
                </button>
              )}
              {phase === "safe" && (
                <div className="space-y-2">
                  <p className="font-semibold text-ok">You marked yourself safe. Tracking has stopped and your contact was told.</p>
                  <button className="btn btn-ghost w-full" onClick={onNewSession}>
                    Start a new session
                  </button>
                </div>
              )}
            </div>
            <p className="text-sm text-muted">If you can, also call 15 (Police) or 1122 (Rescue).</p>
          </div>
        )}

        {/* Ask report */}
        {["ask_report", "closed", "intake", "drafting", "review", "sending", "sent"].includes(phase) && (
          <>
            <Bubble m={{ role: "user", text: "No" }} />
            <Bubble m={{ role: "assistant", text: "Do you want to report a case?" }} />
          </>
        )}
        {phase === "ask_report" && (
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-primary !py-3" disabled={busy} onClick={() => onReport(true)}>
              Yes, report
            </button>
            <button className="btn btn-ghost !py-3" disabled={busy} onClick={() => onReport(false)}>
              No
            </button>
          </div>
        )}
        {phase === "closed" && (
          <>
            <Bubble m={{ role: "user", text: "No" }} />
            <Bubble m={{ role: "assistant", text: "Thank you. You are not alone, and you can come back any time. Pakistan: Police 15, Rescue 1122, Human Rights helpline 1099, Madadgaar 1098." }} />
            <button className="btn btn-ghost w-full" onClick={onNewSession}>
              Start over
            </button>
          </>
        )}

        {/* Intake */}
        {["intake", "drafting", "review", "sending", "sent"].includes(phase) && (
          <>
            <Bubble m={{ role: "user", text: "Yes, report" }} />
            {transcript.map((m, i) => (
              <Bubble key={i} m={m} />
            ))}
            {session?.transcript.length === 0 && phase !== "intake" && (
              <Bubble m={{ role: "system", text: "The conversation was deleted from this session after sending, for your privacy." }} />
            )}
          </>
        )}
        {busy && phase === "intake" && (
          <div className="typing flex gap-1 px-2 text-2xl text-muted" aria-label="Awaaz is typing">
            <span>•</span>
            <span>•</span>
            <span>•</span>
          </div>
        )}
        {dangerPrompt && phase === "intake" && (
          <div className="card space-y-2 border-danger p-3">
            <p className="font-semibold">It sounds like you might be in danger. Are you in danger right now?</p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-danger" onClick={onDangerYes}>
                Yes, alert my contact
              </button>
              <button className="btn btn-ghost" onClick={() => setDangerPrompt(false)}>
                No, continue
              </button>
            </div>
          </div>
        )}

        {drafting && (
          <div className="card flex items-center gap-3 p-3 text-sm">
            <span className="typing text-xl text-muted">
              <span>•</span>
              <span>•</span>
              <span>•</span>
            </span>
            Preparing your two drafts and checking the public one for personal information…
          </div>
        )}

        {/* Review */}
        {phase === "review" && session?.drafts && (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">Please review both versions. Nothing is sent until you press Send.</p>
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="card space-y-2 p-3">
                <h3 className="font-semibold">🔒 This goes to the police</h3>
                <p className="text-xs text-muted">Full details, including your name and contact. Only the police dashboard sees this. You can edit it.</p>
                <textarea className="field min-h-56 text-sm" dir="auto" value={policeText} onChange={(e) => setPoliceText(e.target.value)} />
                <button className="btn btn-ghost w-full text-sm" onClick={() => setRevise({ target: "police", text: "" })}>
                  Ask Awaaz to change it
                </button>
              </div>
              <div className="card space-y-2 p-3">
                <h3 className="font-semibold">🌐 This goes to activist groups and, later, news outlets</h3>
                <p className="text-xs text-muted">It contains no personal information: no names, numbers, addresses or exact workplace.</p>
                {session.drafts.public_clean ? (
                  <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{session.drafts.public_text}</p>
                ) : (
                  <div className="rounded-lg bg-warn-soft p-3 text-sm text-warn">
                    <strong>Public report on hold.</strong> The privacy check could not confirm the public text is free of personal
                    information ({[...new Set(session.drafts.pii_findings.map((f) => f.type))].join(", ") || "no clean draft"}). Nothing will be sent
                    to communities or news. Your police complaint can still be sent. You can ask for a change to try again.
                  </div>
                )}
                <button className="btn btn-ghost w-full text-sm" onClick={() => setRevise({ target: "public", text: "" })}>
                  Request a change
                </button>
              </div>
            </div>
            {revise && (
              <div className="card space-y-2 p-3">
                <label className="text-sm font-semibold" htmlFor="revise">
                  What should change in the {revise.target} version?
                </label>
                <textarea id="revise" className="field text-sm" dir="auto" value={revise.text} onChange={(e) => setRevise({ ...revise, text: e.target.value })} />
                <div className="flex gap-2">
                  <button className="btn btn-primary flex-1" disabled={busy || !revise.text.trim()} onClick={onRevise}>
                    Re-draft
                  </button>
                  <button className="btn btn-ghost" onClick={() => setRevise(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <button className="btn btn-primary w-full text-lg !py-4" disabled={busy} onClick={onConfirm}>
              Send
            </button>
          </div>
        )}

        {/* Receipt */}
        {(phase === "sending" || phase === "sent") && (
          <div className="card space-y-3 p-4">
            <h3 className="text-lg font-semibold">{receipt ? "Your report was sent" : "Sending your report…"}</h3>
            {receipt && (
              <>
                <p className="text-sm">
                  Public reference: <span className="font-mono font-semibold">{receipt.public_ref}</span>
                </p>
                <p className="text-sm">{receipt.police_submitted ? "✓ Your complaint is on the police dashboard." : "Police submission pending."}</p>
                {receipt.public_on_hold && (
                  <p className="rounded-lg bg-warn-soft p-2 text-sm text-warn">The public report was held back by the privacy check. Nothing was shared publicly.</p>
                )}
                {receipt.no_match && <p className="text-sm text-muted">No community matched this case closely enough, so none were emailed.</p>}
                {receipt.communities && receipt.communities.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold">Shared (anonymised) with:</p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {receipt.communities.map((c) => (
                        <li key={c.name} className="rounded-lg bg-surface-2 p-2">
                          <span className="font-medium">{c.name}</span> · score {c.score.toFixed(2)} · {c.status === "dry_run" ? "sent (dry run)" : c.status}
                          <div className="text-xs text-muted">{c.reason}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {dueAt && !cancelled && !escalationOutcome && (
                  <div className="rounded-lg border border-line p-3 text-sm">
                    If the police record no action, the anonymised description goes to news outlets in{" "}
                    <span className="font-mono font-semibold">{fmtCountdown(dueAt, now).text}</span>.
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="btn btn-ghost text-sm" disabled={busy} onClick={onCancel}>
                        Cancel news escalation
                      </button>
                      {health?.demo_routes && (
                        <button className="btn btn-ghost text-sm" disabled={busy} onClick={onFastForward}>
                          Demo: fast-forward 24h
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {cancelled && <p className="text-sm text-ok">News escalation cancelled.</p>}
                {escalationOutcome && <p className="text-sm font-medium">{escalationOutcome}</p>}
                <button className="btn btn-ghost w-full" onClick={onNewSession}>
                  Start a new session
                </button>
              </>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-danger-soft p-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div ref={bottom} />
      </div>

      {phase === "intake" && (
        <form onSubmit={onSend} className="flex gap-2 border-t border-line bg-surface p-3">
          <textarea
            dir="auto"
            rows={1}
            className="field flex-1 resize-none text-[15px]"
            placeholder="Type here… (English, اردو, or Roman Urdu) — you can say “skip”"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) onSend(e);
            }}
            aria-label="Your message"
          />
          <button className="btn btn-primary" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}
