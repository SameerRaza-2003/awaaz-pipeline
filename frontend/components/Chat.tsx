"use client";

import {
  AlertTriangle,
  ArrowUp,
  Check,
  Copy,
  FileText,
  Globe2,
  Loader2,
  MapPin,
  MessageSquare,
  Minus,
  Phone,
  RotateCcw,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
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

type Msg = { role: "user" | "assistant"; text: string };

const hasUrdu = (t: string) => /[؀-ۿ]/.test(t);

const REPORT_STEPS = ["Check-in", "Your account", "Review", "Sent"];
const EMERGENCY_STEPS = ["Check-in", "Alerting", "Tracking", "Safe"];

function stepsFor(phase: string): { steps: string[]; current: number } | null {
  switch (phase) {
    case "ask_report":
      return { steps: REPORT_STEPS, current: 0 };
    case "intake":
      return { steps: REPORT_STEPS, current: 1 };
    case "drafting":
    case "review":
      return { steps: REPORT_STEPS, current: 2 };
    case "sending":
    case "sent":
      return { steps: REPORT_STEPS, current: 3 };
    case "emergency":
      return { steps: EMERGENCY_STEPS, current: 2 };
    case "safe":
      return { steps: EMERGENCY_STEPS, current: 3 };
    default:
      return null;
  }
}

function Stepper({ phase }: { phase: string }) {
  const s = stepsFor(phase);
  if (!s) return null;
  return (
    <ol className="flex items-center gap-1.5 overflow-x-auto px-4 pb-3 text-xs" aria-label="Progress">
      {s.steps.map((label, i) => {
        const done = i < s.current || (i === s.current && (phase === "sent" || phase === "safe"));
        const active = i === s.current && !done;
        return (
          <li key={label} className="flex shrink-0 items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                done ? "bg-accent text-accent-ink" : active ? "border border-accent text-accent" : "border border-line-strong text-muted"
              }`}
            >
              {done ? <Check size={11} strokeWidth={3} /> : i + 1}
            </span>
            <span className={active ? "font-medium text-ink" : done ? "text-ink-2" : "text-muted"}>{label}</span>
            {i < s.steps.length - 1 && <span className="mx-1 h-px w-5 bg-line-strong" />}
          </li>
        );
      })}
    </ol>
  );
}

function Bubble({ m }: { m: Msg }) {
  const mine = m.role === "user";
  const urdu = hasUrdu(m.text);
  return (
    <div className={`rise flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        dir="auto"
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
          mine ? "rounded-br-md bg-accent text-accent-ink" : "rounded-bl-md border border-line bg-surface text-ink"
        } ${urdu ? "urdu" : ""}`}
      >
        {m.text}
      </div>
    </div>
  );
}

type RowState = "pending" | "done" | "failed" | "off";

function StatusRow({ icon: Icon, label, detail, state }: { icon: typeof Phone; label: string; detail: string; state: RowState }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-muted">{detail}</div>
      </div>
      <span className="shrink-0" aria-label={state}>
        {state === "pending" && <Loader2 size={16} className="animate-spin text-run" />}
        {state === "done" && <Check size={16} className="text-ok" />}
        {state === "failed" && <X size={16} className="text-danger" />}
        {state === "off" && <Minus size={16} className="text-muted" />}
      </span>
    </li>
  );
}

function outboundDetail(d: any, sentLabel: string): { state: RowState; detail: string } {
  if (!d) return { state: "pending", detail: "Working…" };
  if (d.status === "sent") return { state: "done", detail: sentLabel };
  if (d.status === "dry_run") return { state: "done", detail: `${sentLabel} (dry run)` };
  if (d.status === "blocked") return { state: "off", detail: "Blocked by the sandbox allowlist" };
  if (d.status === "skipped") return { state: "off", detail: "Not set up on this server" };
  if (d.status === "duplicate") return { state: "done", detail: "Already sent" };
  return { state: "failed", detail: d.error || "Failed" };
}

export function Chat({ sessionId, events, health, onNewSession, onOpenSetup }: Props) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Msg | null>(null);
  const [dangerPrompt, setDangerPrompt] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locDenied, setLocDenied] = useState<{ seconds: number; reason: string } | null>(null);
  const [locText, setLocText] = useState("");
  const [policeText, setPoliceText] = useState("");
  const [revise, setRevise] = useState<{ target: "public" | "police"; text: string } | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [copied, setCopied] = useState(false);
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
  const transcript: Msg[] = useMemo(
    () => [...(session?.transcript ?? []), ...(pending ? [pending] : [])],
    [session?.transcript, pending],
  );

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [transcript.length, busy, phase, locDenied, dangerPrompt, events.length]);

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
    if (r.code === r.PERMISSION_DENIED)
      return { pos: null, reason: "Location permission is off for this site. You can allow it in the browser's site settings." };
    return { pos: null, reason: "Your phone could not get a location fix (no GPS signal, or location services are off)." };
  };

  const getHelp = () =>
    run(async () => {
      setDangerPrompt(false);
      setLocating(true);
      try {
        const { pos, reason } = await getPosition();
        if (pos) await sendDanger({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        else setLocDenied({ seconds: 10, reason });
      } finally {
        setLocating(false);
      }
    });

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

  const emergency = useMemo(() => {
    const out: { location: any; sms: any; call: any; discord: any; started: boolean; finished: boolean; warning: string | null; updates: number } = {
      location: null, sms: null, call: null, discord: null, started: false, finished: false, warning: null, updates: 0,
    };
    for (const e of events) {
      if (e.kind === "workflow.start" && e.data.workflow === "emergency") out.started = true;
      if (e.kind === "status" && e.data.location) out.location = e.data.location;
      if (e.kind === "outbound" && e.agent !== "setup") {
        const k = e.data.kind as string;
        if (e.agent === "tracking_updater") {
          // Count each update once (it may go to SMS and Discord), and not the final "safe" message.
          if (e.data.status !== "duplicate" && String(e.data.body || "").startsWith("Awaaz location update")) {
            const n = Number(String(e.data.body).match(/update (\d+)/)?.[1] || 0);
            out.updates = Math.max(out.updates, n);
          }
        } else if (k === "sms" && !out.sms) out.sms = e.data;
        else if (k === "discord" && !out.discord) out.discord = e.data;
        else if (k === "call" && !out.call) out.call = e.data;
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

  const draftingSteps = useMemo(() => {
    const tools = new Set(events.filter((e) => e.node === "drafting_agent" && e.kind === "tool.start").map((e) => e.data.tool));
    return [
      { label: "Listing details that could identify anyone", done: tools.has("extract_identifiers") },
      { label: "Writing the police complaint and the public summary", done: tools.has("save_drafts") || tools.has("pii_scan") },
      { label: "Checking the public summary for personal information", done: tools.has("review_public_text") },
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

  const copyRef = async () => {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receipt.public_ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const inEmergency = phase === "emergency" || phase === "safe" || emergency.started;
  const reportFlow = ["ask_report", "closed", "intake", "drafting", "review", "sending", "sent"].includes(phase);
  const showHelpButton = !inEmergency && phase !== "loading" && phase !== "gate";

  const locRow: { state: RowState; detail: string } = !emergency.location
    ? { state: "pending", detail: "Finding your position…" }
    : emergency.location.location_available
      ? { state: "done", detail: emergency.location.address || `${emergency.location.lat?.toFixed(5)}, ${emergency.location.lng?.toFixed(5)}` }
      : { state: "failed", detail: "Unavailable: your contact was told" };
  const contactPhone = session?.trusted_contact?.phone || null;
  const contactName = session?.trusted_contact && !session.trusted_contact.is_default ? session.trusted_contact.name : "your contact";
  const smsBody = emergency.location?.maps_link
    ? `I need help. This is where I am: ${emergency.location.maps_link}`
    : "I need help. Please call me now.";
  const channel = (d: any, label: string) =>
    !d && emergency.finished ? { state: "off" as RowState, detail: "Not set up" } : outboundDetail(d, label);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line">
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold">Private session</h1>
            <p className="truncate text-xs text-muted">Anonymous. Nothing is shared without your say.</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {showHelpButton && (
              <button className="btn btn-danger btn-sm" onClick={getHelp} disabled={busy && phase !== "intake"}>
                <ShieldAlert size={15} aria-hidden />
                Get help now
              </button>
            )}
            <button className="btn btn-quiet btn-sm" onClick={onOpenSetup} title="Trusted contact, country, language" aria-label="Setup">
              <Settings2 size={16} aria-hidden />
              <span className="hidden sm:inline">Setup</span>
            </button>
          </div>
        </div>
        <Stepper phase={inEmergency ? (phase === "safe" ? "safe" : "emergency") : phase} />
      </div>

      <div ref={scroller} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        <Bubble m={{ role: "assistant", text: "Are you in danger right now?" }} />

        {phase === "gate" && !locating && !locDenied && (
          <div className="rise grid grid-cols-2 gap-2.5">
            <button className="btn btn-danger !min-h-14 text-base" disabled={busy} onClick={getHelp}>
              Yes, I need help
            </button>
            <button className="btn btn-ghost !min-h-14 text-base" disabled={busy} onClick={answerNo}>
              No
            </button>
            <dl className="col-span-2 mt-3 divide-y divide-line rounded-xl border border-line text-sm">
              <div className="flex gap-3 px-4 py-3">
                <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                <div>
                  <dt className="font-medium">If you say yes</dt>
                  <dd className="text-ink-2">
                    Your trusted contact gets your location right away, by text, call or Discord, with updates until you are safe.{" "}
                    <button className="underline underline-offset-2" onClick={onOpenSetup}>
                      Add a contact
                    </button>{" "}
                    before you need it.
                  </dd>
                </div>
              </div>
              <div className="flex gap-3 px-4 py-3">
                <FileText size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <div>
                  <dt className="font-medium">If you say no</dt>
                  <dd className="text-ink-2">You can report what happened, in your own words. You see both drafts and decide before anything is sent.</dd>
                </div>
              </div>
              <div className="flex gap-3 px-4 py-3">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-ink-2" aria-hidden />
                <div>
                  <dt className="font-medium">Your privacy</dt>
                  <dd className="text-ink-2">No account required. Your details only ever go to the police, never to the public. Quick exit leaves instantly.</dd>
                </div>
              </div>
            </dl>
          </div>
        )}

        {locating && (
          <div className="rise card flex items-center gap-3 p-3 text-sm">
            <Loader2 size={16} className="animate-spin text-run" /> Getting your location…
          </div>
        )}

        {locDenied && (
          <div className="rise card space-y-3 border-warn p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
              <div>
                <p className="font-medium">We couldn&apos;t get your location</p>
                <p className="text-sm text-ink-2">{locDenied.reason}</p>
              </div>
            </div>
            <input className="field" dir="auto" placeholder="Where are you? e.g. near Liberty Market, Gulberg" value={locText} onChange={(e) => setLocText(e.target.value)} />
            <button className="btn btn-danger w-full" onClick={() => setLocDenied((l) => (l ? { ...l, seconds: 0 } : l))}>
              Send alert now
            </button>
            <p className="text-center text-xs text-muted">Sending automatically in {locDenied.seconds}s</p>
          </div>
        )}

        {/* ---------- emergency ---------- */}
        {inEmergency && (
          <div className="rise space-y-3">
            <Bubble m={{ role: "user", text: "Yes, I need help" }} />
            <div className="card overflow-hidden">
              <div className={`flex items-center gap-2 px-4 py-3 text-sm font-medium ${phase === "safe" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
                {phase === "safe" ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
                {phase === "safe" ? "You marked yourself safe. Tracking has stopped." : emergency.finished ? "Your contact has been alerted" : "Alerting your trusted contact"}
              </div>
              <ul className="divide-y divide-line px-4">
                <StatusRow icon={MapPin} label="Your location" {...locRow} />
                <StatusRow icon={MessageSquare} label="Text message" {...channel(emergency.sms, "Delivered to your contact")} />
                <StatusRow icon={Phone} label="Phone call" {...channel(emergency.call, "Calling your contact")} />
                <StatusRow icon={Globe2} label="Discord" {...channel(emergency.discord, "Posted to your contact's channel")} />
              </ul>
              {phase === "emergency" && contactPhone && (
                <div className="border-t border-line px-4 py-3">
                  <p className="mb-2 text-xs text-muted">Reach {contactName} yourself, from your own phone:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <a className="btn btn-danger" href={`tel:${contactPhone}`}>
                      <Phone size={16} aria-hidden /> Call now
                    </a>
                    <a className="btn btn-ghost" href={`sms:${contactPhone}?body=${encodeURIComponent(smsBody)}`}>
                      <MessageSquare size={16} aria-hidden /> Text location
                    </a>
                  </div>
                </div>
              )}
              {emergency.location?.location_available && (
                <div className="border-t border-line">
                  <iframe
                    title="Your location"
                    className="h-52 w-full"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    src={
                      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
                        ? `https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${emergency.location.lat},${emergency.location.lng}&zoom=16`
                        : `https://maps.google.com/maps?q=${emergency.location.lat},${emergency.location.lng}&z=16&output=embed`
                    }
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-muted">
                    <a className="text-run underline underline-offset-2" href={emergency.location.maps_link} target="_blank" rel="noreferrer">
                      Open in Google Maps
                    </a>
                    <span>
                      {emergency.updates > 0 && `${emergency.updates} location update${emergency.updates > 1 ? "s" : ""} sent · `}
                      {emergency.location.address_source === "openstreetmap" && "Address © OpenStreetMap contributors"}
                    </span>
                  </div>
                </div>
              )}
              {emergency.warning && (
                <div className="flex items-start gap-2 border-t border-line bg-warn-soft px-4 py-2.5 text-xs text-warn">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    {emergency.warning}{" "}
                    <button className="underline underline-offset-2" onClick={onOpenSetup}>
                      Open setup
                    </button>
                  </span>
                </div>
              )}
              <div className="border-t border-line p-4">
                {phase === "safe" ? (
                  <button className="btn btn-ghost w-full" onClick={onNewSession}>
                    <RotateCcw size={15} /> Start a new session
                  </button>
                ) : (
                  <button className="btn btn-primary w-full !min-h-12 text-base" disabled={busy} onClick={onSafe}>
                    <ShieldCheck size={18} /> I&apos;m safe now
                  </button>
                )}
              </div>
            </div>
            <p className="text-center text-xs text-muted">If you can, also call 15 (Police) or 1122 (Rescue).</p>
          </div>
        )}

        {/* ---------- report ---------- */}
        {reportFlow && !inEmergency && (
          <>
            <Bubble m={{ role: "user", text: "No" }} />
            <Bubble m={{ role: "assistant", text: "Would you like to report what happened? You can stop at any point, and nothing is sent until you approve it." }} />
          </>
        )}
        {phase === "ask_report" && (
          <div className="rise grid grid-cols-2 gap-2.5">
            <button className="btn btn-primary !min-h-12" disabled={busy} onClick={() => startReport(true)}>
              Yes, report it
            </button>
            <button className="btn btn-ghost !min-h-12" disabled={busy} onClick={() => startReport(false)}>
              Not now
            </button>
          </div>
        )}
        {phase === "closed" && (
          <>
            <Bubble m={{ role: "user", text: "Not now" }} />
            <div className="rise card space-y-3 p-4 text-sm">
              <p>You are not alone, and you can come back at any time.</p>
              <ul className="space-y-1 text-ink-2">
                <li>Police emergency: <strong>15</strong></li>
                <li>Rescue: <strong>1122</strong></li>
                <li>Human Rights helpline: <strong>1099</strong></li>
                <li>Madadgaar (women and children): <strong>1098</strong></li>
              </ul>
              <button className="btn btn-ghost w-full" onClick={onNewSession}>
                <RotateCcw size={15} /> Start over
              </button>
            </div>
          </>
        )}

        {["intake", "drafting", "review", "sending", "sent"].includes(phase) && (
          <>
            <Bubble m={{ role: "user", text: "Yes, report it" }} />
            {transcript.map((m, i) => (
              <Bubble key={i} m={m} />
            ))}
            {session?.transcript.length === 0 && phase !== "intake" && (
              <p className="text-center text-xs text-muted">The conversation was deleted from this session after sending, for your privacy.</p>
            )}
          </>
        )}

        {busy && phase === "intake" && (
          <div className="typing flex gap-1 px-1 py-2" aria-label="Awaaz is typing">
            <span />
            <span />
            <span />
          </div>
        )}

        {dangerPrompt && phase === "intake" && (
          <div className="rise card space-y-3 border-danger p-4">
            <p className="text-sm">It sounds like you might not be safe right now. Do you want to alert your trusted contact with your location?</p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-danger" onClick={getHelp}>
                Alert my contact
              </button>
              <button className="btn btn-ghost" onClick={() => setDangerPrompt(false)}>
                Continue the report
              </button>
            </div>
          </div>
        )}

        {phase === "drafting" && (
          <div className="rise card space-y-2 p-4">
            <p className="text-sm font-medium">Preparing your two drafts</p>
            <ul className="space-y-1.5 text-sm">
              {draftingSteps.map((s, i) => {
                const active = !s.done && (i === 0 || draftingSteps[i - 1].done);
                return (
                  <li key={s.label} className={`flex items-center gap-2 ${s.done ? "text-ink-2" : active ? "text-ink" : "text-muted"}`}>
                    {s.done ? (
                      <Check size={14} className="text-ok" />
                    ) : active ? (
                      <Loader2 size={14} className="animate-spin text-run" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full border border-line-strong" />
                    )}
                    {s.label}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {phase === "review" && session?.drafts && (
          <div className="rise space-y-3">
            <p className="text-sm text-ink-2">Please read both versions. Nothing is sent until you press Send.</p>
            <section className="card overflow-hidden">
              <header className="flex items-start gap-3 border-b border-line px-4 py-3">
                <FileText size={18} className="mt-0.5 shrink-0 text-ink-2" />
                <div>
                  <h3 className="text-sm font-semibold">Police complaint</h3>
                  <p className="text-xs text-muted">Full details, including your name and contact. Only the police dashboard sees this. You can edit it.</p>
                </div>
              </header>
              <textarea
                className="block min-h-56 w-full resize-y bg-surface px-4 py-3 text-sm leading-relaxed outline-none"
                dir="auto"
                value={policeText}
                onChange={(e) => setPoliceText(e.target.value)}
                aria-label="Police complaint text"
              />
              <footer className="border-t border-line px-4 py-2">
                <button className="btn btn-quiet btn-sm" onClick={() => setRevise({ target: "police", text: "" })}>
                  Ask Awaaz to revise
                </button>
              </footer>
            </section>

            <section className="card overflow-hidden">
              <header className="flex items-start gap-3 border-b border-line px-4 py-3">
                <Globe2 size={18} className="mt-0.5 shrink-0 text-ink-2" />
                <div>
                  <h3 className="text-sm font-semibold">Public summary</h3>
                  <p className="text-xs text-muted">
                    Shared with matched activist groups, and with news outlets if the police take no action within 24 hours. Contains no personal details.
                  </p>
                </div>
              </header>
              {session.drafts.public_clean ? (
                <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed">{session.drafts.public_text}</p>
              ) : (
                <div className="m-4 flex items-start gap-2 rounded-lg bg-warn-soft p-3 text-sm text-warn">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>On hold.</strong> The privacy check could not confirm this summary is free of personal information, so it will not be
                    shared. Your police complaint can still be sent. You can ask for changes and try again.
                  </span>
                </div>
              )}
              <footer className="border-t border-line px-4 py-2">
                <button className="btn btn-quiet btn-sm" onClick={() => setRevise({ target: "public", text: "" })}>
                  Request changes
                </button>
              </footer>
            </section>

            {revise && (
              <div className="card space-y-2 p-4">
                <label className="text-sm font-medium" htmlFor="revise">
                  What should change in the {revise.target === "police" ? "police complaint" : "public summary"}?
                </label>
                <textarea id="revise" className="field text-sm" dir="auto" rows={3} value={revise.text} onChange={(e) => setRevise({ ...revise, text: e.target.value })} />
                <div className="flex gap-2">
                  <button className="btn btn-primary flex-1" disabled={busy || !revise.text.trim()} onClick={onRevise}>
                    Revise
                  </button>
                  <button className="btn btn-ghost" onClick={() => setRevise(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {(phase === "sending" || phase === "sent") && (
          <div className="rise card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line bg-ok-soft px-4 py-3 text-sm font-medium text-ok">
              {receipt ? <ShieldCheck size={16} /> : <Loader2 size={16} className="animate-spin" />}
              {receipt ? "Your report was sent" : "Sending your report…"}
            </div>
            {receipt && (
              <div className="divide-y divide-line">
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <div className="label">Reference</div>
                    <div className="font-mono text-sm font-medium">{receipt.public_ref}</div>
                  </div>
                  <button className="btn btn-quiet btn-sm" onClick={copyRef}>
                    {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="px-4 py-3 text-sm">
                  <div className="label mb-1">Police</div>
                  {receipt.police_submitted ? "Your complaint is on the police dashboard." : "Submission pending."}
                </div>
                <div className="px-4 py-3 text-sm">
                  <div className="label mb-1">Activist groups</div>
                  {receipt.public_on_hold && <p className="text-warn">The public summary was held back by the privacy check. Nothing was shared publicly.</p>}
                  {receipt.no_match && <p className="text-muted">No group matched this case closely enough, so none were emailed.</p>}
                  {receipt.communities && receipt.communities.length > 0 && (
                    <ul className="space-y-2">
                      {receipt.communities.map((c) => (
                        <li key={c.name}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium">{c.name}</span>
                            <span className="font-mono text-xs text-muted">match {c.score.toFixed(2)}</span>
                          </div>
                          <p className="text-xs text-muted">{c.reason}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {receipt.authority && (
                  <div className="px-4 py-3 text-sm">
                    <div className="label mb-1">Authority</div>
                    The social-media-post version was {receipt.authority.status === "sent" ? "emailed to" : receipt.authority.status === "dry_run" ? "prepared for (dry run)" : "queued for"} the relevant authority.
                  </div>
                )}
                {(dueAt || escalationOutcome || cancelled) && (
                  <div className="px-4 py-3 text-sm">
                    <div className="label mb-1">News outlets</div>
                    {escalationOutcome ? (
                      <p>{escalationOutcome}</p>
                    ) : cancelled ? (
                      <p className="text-ink-2">News escalation cancelled.</p>
                    ) : (
                      <>
                        <p className="text-ink-2">
                          If the police record no action, the public summary goes to news outlets in{" "}
                          <span className="font-mono font-medium text-ink">{fmtCountdown(dueAt, now).text}</span>.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
                            Cancel news escalation
                          </button>
                          {health?.demo_routes && (
                            <button className="btn btn-quiet btn-sm" disabled={busy} onClick={onFastForward}>
                              Demo: skip to deadline
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div className="p-4">
                  <button className="btn btn-ghost w-full" onClick={onNewSession}>
                    <RotateCcw size={15} /> Start a new session
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
      </div>

      {phase === "intake" && (
        <div className="border-t border-line bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          <div className="mb-2 flex gap-1.5 overflow-x-auto">
            {[
              ["Skip this question", "skip"],
              ["That's all I want to share", "That's all I want to share."],
            ].map(([label, text]) => (
              <button
                key={label}
                className="shrink-0 rounded-full border border-line-strong px-3 py-1 text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                disabled={busy}
                onClick={() => sendMessage(text)}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
          >
            <textarea
              ref={composer}
              dir="auto"
              rows={1}
              className={`field max-h-36 min-h-[44px] flex-1 resize-none ${hasUrdu(input) ? "urdu" : ""}`}
              placeholder="Write in English, اردو or Roman Urdu"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              aria-label="Your message"
            />
            <button className="btn btn-primary !min-h-[44px] !w-11 !px-0" disabled={busy || !input.trim()} aria-label="Send">
              <ArrowUp size={18} />
            </button>
          </form>
        </div>
      )}

      {phase === "review" && session?.drafts && (
        <div className="border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button className="btn btn-primary w-full !min-h-12 text-base" disabled={busy} onClick={onConfirm}>
            <Send size={16} /> {session.drafts.public_clean ? "Send to police and activist groups" : "Send to police only"}
          </button>
        </div>
      )}
    </div>
  );
}
