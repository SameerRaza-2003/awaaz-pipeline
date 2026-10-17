"use client";

import { ArrowUp, Check, Loader2, RotateCcw, Settings2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Emergency, EmergencyState } from "@/components/chat/Emergency";
import { Gate, HelpProps, HelpStates, helpActive } from "@/components/chat/Gate";
import { EmergencyNumbers, ICON, Message, Msg, STROKE, Typing, hasUrdu } from "@/components/chat/parts";
import { Receipt as ReceiptView } from "@/components/chat/Receipt";
import { PrivacyEvidence, Review } from "@/components/chat/Review";
import { api, ApiError, AwaazEvent, Health, Receipt, SessionInfo, store } from "@/lib/api";

type Props = {
  sessionId: string;
  events: AwaazEvent[];
  health: Health | null;
  onNewSession: () => void;
  onOpenSetup: () => void;
};

const LANGS = [
  { id: "en", label: "English", placeholder: "Write your answer" },
  { id: "roman", label: "Roman Urdu", placeholder: "Apna jawab likhein" },
  { id: "ur", label: "اردو", placeholder: "اپنا جواب لکھیں" },
] as const;
type Lang = (typeof LANGS)[number]["id"];

const STEP: Record<string, [number, string]> = {
  ask_report: [1, "Check-in"],
  intake: [2, "What happened"],
  drafting: [3, "Review"],
  review: [3, "Review"],
  sending: [4, "Sent"],
  sent: [4, "Sent"],
};

export function Chat({ sessionId, events, health, onNewSession, onOpenSetup }: Props) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Msg | null>(null);
  const [dangerPrompt, setDangerPrompt] = useState(false);
  const [locating, setLocating] = useState(false);
  const [armed, setArmed] = useState<number | null>(null); // seconds left before a one-tap alert is sent
  const [noContact, setNoContact] = useState(false);
  const [locDenied, setLocDenied] = useState<{ seconds: number; reason: string } | null>(null);
  const [locText, setLocText] = useState("");
  const [policeText, setPoliceText] = useState("");
  const [revise, setRevise] = useState<{ target: "public" | "police"; text: string } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [now, setNow] = useState(() => Date.now());
  const watchId = useRef<number | null>(null);
  const lastPost = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api<SessionInfo>(`/api/sessions/${sessionId}`);
      setSession(s);
      if (s.drafts) setPoliceText((p) => p || s.drafts!.police_text);
      if (s.locale === "ur" || s.locale === "roman" || s.locale === "en") setLang(s.locale);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) onNewSession();
    }
  }, [sessionId, onNewSession]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Pull fresh server state when the workflow reaches a checkpoint.
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

  const phase = session?.phase ?? "loading";
  const transcript: Msg[] = useMemo(() => [...(session?.transcript ?? []), ...(pending ? [pending] : [])], [session?.transcript, pending]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [transcript.length, busy, phase, dangerPrompt]);

  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    },
    [],
  );

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

  // ---------------- emergency ----------------
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

  // GPS first; with no fix (e.g. indoors) fall back to Wi-Fi/cell location before giving up.
  const getPosition = async (): Promise<{ pos: GeolocationPosition | null; reason: string }> => {
    if (!window.isSecureContext)
      return { pos: null, reason: "This page was opened over http://, and phones only share location with secure (https://) pages." };
    if (!navigator.geolocation) return { pos: null, reason: "This browser does not support location." };
    const attempt = (high: boolean, timeout: number) =>
      new Promise<GeolocationPosition | GeolocationPositionError>((resolve) =>
        navigator.geolocation.getCurrentPosition(resolve, resolve, { enableHighAccuracy: high, timeout, maximumAge: 60000 }),
      );
    let r = await attempt(true, 7000);
    if (!("coords" in r) && r.code !== r.PERMISSION_DENIED) r = await attempt(false, 6000);
    if ("coords" in r) return { pos: r, reason: "" };
    if (r.code === r.PERMISSION_DENIED) return { pos: null, reason: "Location permission is off for this site. You can allow it in the browser's site settings." };
    return { pos: null, reason: "Your phone could not get a location fix (no GPS signal, or location services are off)." };
  };

  const getHelp = () =>
    run(async () => {
      setDangerPrompt(false);
      setArmed(null);
      // Nobody to alert: say so immediately and offer emergency numbers instead of waiting for nothing.
      const latest = await api<SessionInfo>(`/api/sessions/${sessionId}`).catch(() => session);
      if (!latest?.trusted_contact) {
        setNoContact(true);
        return;
      }
      setNoContact(false);
      setLocating(true);
      try {
        const { pos, reason } = await getPosition();
        if (pos) await sendDanger({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        else setLocDenied({ seconds: 10, reason });
      } finally {
        setLocating(false);
      }
    });

  // Coming from the welcome screen's emergency button: arm the 3-second countdown.
  useEffect(() => {
    if (phase === "gate" && store.get("awaaz_autohelp")) {
      store.del("awaaz_autohelp");
      setArmed(3);
    }
  }, [phase]);

  // One-tap shortcuts wait 3 seconds so an accidental tap can be cancelled. The explicit "Yes" answer does not.
  useEffect(() => {
    if (armed === null) return;
    if (armed <= 0) {
      setArmed(null);
      getHelp();
      return;
    }
    const t = setTimeout(() => setArmed((a) => (a === null ? null : a - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  // Without location the alert still goes out after a short countdown: help is never held back.
  useEffect(() => {
    if (!locDenied) return;
    if (locDenied.seconds <= 0) {
      setLocDenied(null);
      run(() => sendDanger(undefined, locText));
      return;
    }
    const t = setTimeout(() => setLocDenied((l) => (l ? { ...l, seconds: l.seconds - 1 } : l)), 1000);
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

  const em: EmergencyState = useMemo(() => {
    const out: EmergencyState = {
      location: null,
      sms: null,
      call: null,
      discord: null,
      started: false,
      finished: false,
      warning: null,
      updates: 0,
      alertAt: null,
      lastLocationAt: null,
    };
    for (const e of events) {
      if (e.kind === "workflow.start" && e.data.workflow === "emergency") out.started = true;
      if (e.kind === "status" && e.data.location) {
        out.location = e.data.location;
        out.lastLocationAt = e.data.location.captured_at || e.ts;
      }
      if (e.kind === "outbound" && e.agent !== "setup") {
        const k = e.data.kind as string;
        if (e.agent === "tracking_updater") {
          const body = String(e.data.body || "");
          if (e.data.status !== "duplicate" && body.startsWith("Awaaz location update")) {
            out.updates = Math.max(out.updates, Number(body.match(/update (\d+)/)?.[1] || 0));
            out.lastLocationAt = e.ts;
          }
        } else {
          if (k === "sms" && !out.sms) out.sms = e.data;
          else if (k === "discord" && !out.discord) out.discord = e.data;
          else if (k === "call" && !out.call) out.call = e.data;
          if (!out.alertAt && ["sent", "dry_run"].includes(e.data.status)) out.alertAt = e.ts;
        }
      }
      if (e.kind === "workflow.end" && e.data.workflow === "emergency") out.finished = true;
      if ((e.kind === "error" || e.kind === "status") && e.data.warning) out.warning = e.data.message;
    }
    return out;
  }, [events]);

  // ---------------- report ----------------
  const answerNo = () =>
    run(async () => {
      await api(`/api/sessions/${sessionId}/danger`, { body: { answer: "no" } });
      await refresh();
    });

  const startReport = (yes: boolean) =>
    run(async () => {
      await api(`/api/sessions/${sessionId}/report/start`, { body: { wants_report: yes } });
      await refresh();
      setTimeout(() => composer.current?.focus(), 50);
    });

  const chooseLang = (l: Lang) => {
    setLang(l);
    api(`/api/sessions/${sessionId}/settings`, { method: "PUT", body: { locale: l } }).catch(() => {});
    setTimeout(() => composer.current?.focus(), 0);
  };

  const sendMessage = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    if (composer.current) composer.current.style.height = "auto";
    setPending({ role: "user", text: t });
    run(async () => {
      try {
        const r = await api<{ reply: string; finalized: boolean; danger_suspected: boolean }>(`/api/sessions/${sessionId}/messages`, { body: { text: t } });
        if (r.danger_suspected) setDangerPrompt(true);
        await refresh();
      } finally {
        setPending(null);
      }
    });
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

  // What the privacy layer actually did, shown on the review screen.
  const privacy: PrivacyEvidence = useMemo(() => {
    const out: PrivacyEvidence = { identifiers: null, reviewed: null, scans: 0 };
    for (const e of events) {
      if (e.kind !== "tool.end") continue;
      if (e.data.tool === "extract_identifiers" && e.data.result) out.identifiers = e.data.result.count ?? null;
      if (e.data.tool === "review_public_text" && e.data.result) out.reviewed = !!e.data.result.clean;
      if (e.data.tool === "pii_scan") out.scans += 1;
    }
    return out;
  }, [events]);

  const draftingSteps = useMemo(() => {
    const tools = new Set(events.filter((e) => e.node === "drafting_agent" && e.kind === "tool.start").map((e) => e.data.tool));
    return [
      { label: "Finding anything that could identify you or others", done: tools.has("extract_identifiers") || tools.has("pii_scan") },
      { label: "Writing the police complaint and the public summary", done: tools.has("save_drafts") },
      { label: "Checking the public summary for personal details", done: tools.has("review_public_text") },
    ];
  }, [events]);

  const onCancel = () =>
    run(async () => {
      if (!receipt) return;
      await api(`/api/complaints/${receipt.public_ref}/cancel-escalation`, { body: {} });
      setCancelled(true);
    });

  const onFastForward = () =>
    run(async () => {
      if (receipt) await api(`/api/demo/fast-forward/${receipt.public_ref}`, { body: {} });
    });

  const tc = session?.trusted_contact ?? null;
  const contactName = tc && !tc.is_default && tc.name ? tc.name : tc ? "your trusted contact" : null;
  const inEmergency = phase === "emergency" || phase === "safe" || em.started;
  const help: HelpProps = {
    contactName,
    onOpenSetup,
    armed,
    onSendNow: () => setArmed(0),
    onCancelArmed: () => setArmed(null),
    noContact,
    onCloseNoContact: () => setNoContact(false),
    locating,
    locDenied,
    locText,
    setLocText,
    onSendWithoutLocation: () => setLocDenied((l) => (l ? { ...l, seconds: 0 } : l)),
  };
  const showHelpShortcut = ["ask_report", "intake", "drafting", "review"].includes(phase) && !helpActive(help);
  const step = STEP[phase];
  const langDef = LANGS.find((l) => l.id === lang) ?? LANGS[0];
  const urduInput = lang === "ur" || hasUrdu(input);

  // ---------------- render ----------------
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-14 items-center gap-2 border-b border-line px-5 sm:px-8">
        <p className="min-w-0 text-small leading-tight text-ink-2">
          <span className="block font-semibold text-ink">Private session</span>
          {step && !inEmergency && (
            <span className="tabular block truncate text-caption">
              Step {step[0]} of 4<span className="hidden sm:inline">: {step[1]}</span>
            </span>
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {showHelpShortcut && (
            <button className="btn btn-danger btn-compact !min-h-11 whitespace-nowrap" onClick={() => setArmed(3)} disabled={busy && phase !== "intake"}>
              <ShieldAlert size={ICON.sm} strokeWidth={STROKE} aria-hidden />
              Get help<span className="hidden sm:inline"> now</span>
            </button>
          )}
          <button className="btn btn-quiet btn-compact !min-h-11 !no-underline" onClick={onOpenSetup} aria-label="Setup: trusted contact, country, language">
            <Settings2 size={ICON.md} strokeWidth={STROKE} aria-hidden />
            <span className="hidden sm:inline">Setup</span>
          </button>
        </div>
      </div>

      {phase === "loading" ? (
        <div className="flex flex-1 items-center justify-center" role="status">
          <Loader2 size={ICON.lg} strokeWidth={STROKE} className="animate-spin text-muted" aria-hidden />
          <span className="sr-only">Loading</span>
        </div>
      ) : inEmergency ? (
        <Emergency
          phase={phase}
          em={em}
          contactName={contactName ?? "your trusted contact"}
          contactPhone={tc?.phone ?? null}
          now={now}
          busy={busy}
          onSafe={onSafe}
          onNewSession={onNewSession}
          onOpenSetup={onOpenSetup}
        />
      ) : phase === "gate" ? (
        <Gate {...help} busy={busy} onYes={getHelp} onNo={answerNo} />
      ) : (
        <>
          <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8" tabIndex={0} aria-label="Conversation">
            <div className="mx-auto max-w-2xl space-y-5">
              {!["ask_report", "closed"].includes(phase) && <h1 className="sr-only">Your report</h1>}
              {phase === "ask_report" && (
                <div className="appear">
                  <h1 className="text-display font-semibold">Do you want to report what happened?</h1>
                  <p className="mt-3 text-lead text-ink-2">
                    We will ask a few gentle questions, one at a time. You can skip any of them, stop at any point, and nothing is sent until you approve
                    it.
                  </p>
                </div>
              )}

              {phase === "closed" && (
                <div className="appear space-y-4">
                  <h1 className="text-display font-semibold">You can come back at any time.</h1>
                  <p className="text-lead text-ink-2">If you ever feel unsafe, open Awaaz and answer Yes to alert your trusted contact.</p>
                  <EmergencyNumbers />
                  <p className="text-small text-ink-2">
                    Human Rights helpline <a className="font-semibold underline underline-offset-4" href="tel:1099">1099</a> · Madadgaar (women and children){" "}
                    <a className="font-semibold underline underline-offset-4" href="tel:1098">1098</a>
                  </p>
                </div>
              )}

              {["intake", "drafting", "review", "sending", "sent"].includes(phase) && (
                <>
                  {transcript.length === 0 && phase !== "intake" ? (
                    <p className="text-small text-muted">The conversation was deleted from this session after sending, for your privacy.</p>
                  ) : (
                    <ol className="space-y-5" aria-label="Messages">
                      {transcript.map((m, i) => (
                        <li key={i}>
                          <Message m={m} />
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}

              {busy && phase === "intake" && <Typing />}

              {dangerPrompt && phase === "intake" && !helpActive(help) && (
                <div className="appear border-l-4 border-danger pl-4" role="alert">
                  <p className="text-body font-semibold">It sounds like you may not be safe right now.</p>
                  <p className="text-body text-ink-2">Do you want to alert your trusted contact with your location?</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button className="btn btn-danger" onClick={getHelp}>
                      Alert them now
                    </button>
                    <button className="btn btn-secondary" onClick={() => setDangerPrompt(false)}>
                      Keep reporting
                    </button>
                  </div>
                </div>
              )}

              {phase === "drafting" && (
                <section className="appear" aria-labelledby="drafting-title" aria-live="polite">
                  <h2 id="drafting-title" className="text-lead font-semibold">
                    Preparing your two versions
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {draftingSteps.map((s, i) => {
                      const active = !s.done && (i === 0 || draftingSteps[i - 1].done);
                      return (
                        <li key={s.label} className={`flex items-center gap-3 text-body ${s.done || active ? "text-ink" : "text-muted"}`}>
                          {s.done ? (
                            <Check size={ICON.md} strokeWidth={2.25} className="text-safe-ink" aria-hidden />
                          ) : active ? (
                            <Loader2 size={ICON.md} strokeWidth={STROKE} className="animate-spin text-info" aria-hidden />
                          ) : (
                            <span className="h-5 w-5 rounded-full border border-line-strong" aria-hidden />
                          )}
                          {s.label}
                          <span className="sr-only">{s.done ? ", done" : active ? ", in progress" : ", waiting"}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {phase === "review" && session?.drafts && (
                <Review
                  drafts={session.drafts}
                  policeText={policeText}
                  setPoliceText={setPoliceText}
                  privacy={privacy}
                  busy={busy}
                  revise={revise}
                  setRevise={setRevise}
                  onRevise={onRevise}
                  onConfirm={onConfirm}
                />
              )}

              {(phase === "sending" || phase === "sent") && (
                <ReceiptView
                  receipt={receipt}
                  dueAt={dueAt}
                  outcome={escalationOutcome}
                  cancelled={cancelled}
                  now={now}
                  busy={busy}
                  health={health}
                  onCancel={onCancel}
                  onFastForward={onFastForward}
                  onNewSession={onNewSession}
                />
              )}

              {error && (
                <p className="border-l-4 border-danger pl-4 text-body text-danger-ink" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>

          {helpActive(help) && (
            <div className="border-t border-line bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
              <HelpStates {...help} />
            </div>
          )}

          {phase === "ask_report" && !helpActive(help) && (
            <div className="border-t border-line bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
              <div className="grid gap-3 sm:grid-cols-2">
                <button className="btn btn-primary !min-h-14" disabled={busy} onClick={() => startReport(true)}>
                  Yes, I want to report it
                </button>
                <button className="btn btn-secondary !min-h-14" disabled={busy} onClick={() => startReport(false)}>
                  Not now
                </button>
              </div>
            </div>
          )}

          {phase === "closed" && (
            <div className="border-t border-line bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
              <button className="btn btn-secondary w-full" onClick={onNewSession}>
                <RotateCcw size={ICON.md} strokeWidth={STROKE} aria-hidden /> Start over
              </button>
            </div>
          )}

          {phase === "intake" && !helpActive(help) && (
            <div className="border-t border-line bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div role="radiogroup" aria-label="Language" className="flex rounded-md border border-line-strong p-0.5">
                  {LANGS.map((l) => (
                    <button
                      key={l.id}
                      role="radio"
                      aria-checked={lang === l.id}
                      onClick={() => chooseLang(l.id)}
                      lang={l.id === "ur" ? "ur" : undefined}
                      className={`min-h-9 rounded-sm px-2.5 text-caption font-semibold ${lang === l.id ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"} ${
                        l.id === "ur" ? "urdu !leading-none" : ""
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-4 text-small">
                  <button className="btn-quiet min-h-9 disabled:opacity-40" disabled={busy} onClick={() => sendMessage("skip")}>
                    Skip question
                  </button>
                  <button className="btn-quiet min-h-9 disabled:opacity-40" disabled={busy} onClick={() => sendMessage("That's all I want to share.")}>
                    That&apos;s all
                  </button>
                </div>
              </div>
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage(input);
                }}
              >
                <label htmlFor="composer" className="sr-only">
                  Your message
                </label>
                <textarea
                  id="composer"
                  ref={composer}
                  dir={lang === "ur" ? "rtl" : "auto"}
                  lang={urduInput ? "ur" : undefined}
                  rows={1}
                  className={`field max-h-40 min-h-12 flex-1 resize-none ${urduInput ? "urdu" : ""}`}
                  placeholder={langDef.placeholder}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      sendMessage(input);
                    }
                  }}
                />
                <button className="btn btn-primary !min-h-12 !w-12 shrink-0 !px-0" disabled={busy || !input.trim()} aria-label="Send message">
                  <ArrowUp size={ICON.md} strokeWidth={2} aria-hidden />
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
