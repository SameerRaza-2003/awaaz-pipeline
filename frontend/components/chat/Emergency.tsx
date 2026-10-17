"use client";

import { Globe2, MapPin, MessageSquare, Phone, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { EmergencyNumbers, ICON, RowState, STATE_WORD, STROKE, StateIcon, ago, clock } from "./parts";

export type EmergencyState = {
  location: any;
  sms: any;
  call: any;
  discord: any;
  started: boolean;
  finished: boolean;
  warning: string | null;
  updates: number;
  alertAt: string | null;
  lastLocationAt: string | null;
};

type Props = {
  phase: string;
  em: EmergencyState;
  contactName: string;
  contactPhone: string | null;
  now: number;
  busy: boolean;
  onSafe: () => void;
  onNewSession: () => void;
  onOpenSetup: () => void;
};

function channelState(d: any, finished: boolean): { state: RowState; note: string } {
  if (!d) return finished ? { state: "off", note: "Not set up on this server" } : { state: "pending", note: "Sending…" };
  switch (d.status) {
    case "sent":
      return { state: "done", note: "Delivered to the provider" };
    case "dry_run":
      return { state: "done", note: "Dry run: logged, not sent" };
    case "duplicate":
      return { state: "done", note: "Already sent" };
    case "skipped":
      return { state: "off", note: "Not set up on this server" };
    case "blocked":
      return { state: "off", note: "Blocked by the test allowlist" };
    default:
      return { state: "failed", note: d.error || "Could not be sent" };
  }
}

export function Emergency({ phase, em, contactName, contactPhone, now, busy, onSafe, onNewSession, onOpenSetup }: Props) {
  const [showMap, setShowMap] = useState(false);
  const safe = phase === "safe";
  const channels = [
    { key: "sms", label: "Text message", icon: MessageSquare, ...channelState(em.sms, em.finished) },
    { key: "call", label: "Phone call", icon: Phone, ...channelState(em.call, em.finished) },
    { key: "discord", label: "Discord", icon: Globe2, ...channelState(em.discord, em.finished) },
  ];
  const reached = channels.filter((c) => c.state === "done").map((c) => c.label.toLowerCase().replace("text message", "text").replace("phone call", "call"));
  const loc = em.location;

  let headline: string;
  let detail: string;
  if (safe) {
    headline = "You are marked safe.";
    detail = `${contactName} was told and location updates have stopped.`;
  } else if (reached.length) {
    headline = `${cap(contactName)} has been alerted.`;
    detail = `By ${list(reached)} at ${clock(em.alertAt)} (${ago(em.alertAt, now)}).`;
  } else if (em.finished) {
    headline = `${cap(contactName)} could not be alerted automatically.`;
    detail = contactPhone ? "Call or text them yourself with the buttons below." : "Call the emergency numbers below.";
  } else {
    headline = `Alerting ${contactName}…`;
    detail = "Your location is being sent now.";
  }
  const announce = safe ? "Marked safe." : `${headline} ${detail}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" tabIndex={0} aria-label="Emergency status">
        <section className="px-5 pb-5 pt-6 sm:px-8" aria-labelledby="em-headline">
          <p className={`label flex items-center gap-2 ${safe ? "!text-safe-ink" : "!text-danger-ink"}`}>
            <span className={`h-2 w-2 rounded-full ${safe ? "bg-safe" : "ping bg-danger text-danger"}`} aria-hidden />
            {safe ? "Emergency closed" : "Emergency active"}
          </p>
          <h1 id="em-headline" className="mt-2 text-title font-semibold sm:text-display">
            {headline}
          </h1>
          <p className="mt-2 text-lead text-ink-2">{detail}</p>
          {!safe && em.lastLocationAt && (
            <p className="tabular mt-3 text-small text-ink-2">
              Last location sent {clock(em.lastLocationAt)} ({ago(em.lastLocationAt, now)}). New updates go out every 2 minutes while this page stays open
              {em.updates > 0 ? `; ${em.updates} sent so far.` : "."}
            </p>
          )}
        </section>

        {!safe && contactPhone && (
          <section className="grid grid-cols-2 gap-3 px-5 pb-5 sm:px-8" aria-label={`Reach ${contactName} yourself`}>
            <a className="btn btn-secondary !min-h-14" href={`tel:${contactPhone}`}>
              <Phone size={ICON.md} strokeWidth={STROKE} aria-hidden /> Call {short(contactName)}
            </a>
            <a
              className="btn btn-secondary !min-h-14"
              href={`sms:${contactPhone}?body=${encodeURIComponent(loc?.maps_link ? `I need help. This is where I am: ${loc.maps_link}` : "I need help. Please call me now.")}`}
            >
              <MessageSquare size={ICON.md} strokeWidth={STROKE} aria-hidden /> Text location
            </a>
          </section>
        )}

        <section className="border-t border-line px-5 sm:px-8" aria-labelledby="em-channels">
          <h2 id="em-channels" className="label pt-4">
            How {contactName} was reached
          </h2>
          <ul className="divide-y divide-line">
            <li className="flex items-start gap-3 py-3">
              <MapPin size={ICON.md} strokeWidth={STROKE} className="mt-0.5 shrink-0 text-ink-2" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Your location</p>
                <p className="text-small text-ink-2 [overflow-wrap:anywhere]">
                  {!loc
                    ? "Finding your position…"
                    : loc.location_available
                      ? loc.address || `${loc.lat?.toFixed(5)}, ${loc.lng?.toFixed(5)}`
                      : "Unavailable. Your contact was told."}
                </p>
                {loc?.location_available && (
                  <p className="tabular text-caption text-muted">
                    {loc.lat?.toFixed(5)}, {loc.lng?.toFixed(5)}
                    {loc.accuracy_m ? ` · accurate to about ${Math.round(loc.accuracy_m)} m` : ""}
                    {loc.address_source === "openstreetmap" ? " · address © OpenStreetMap contributors" : ""}
                  </p>
                )}
              </div>
              <span className="flex items-center gap-1.5 text-small">
                <StateIcon state={!loc ? "pending" : loc.location_available ? "done" : "failed"} />
                <span className={!loc ? "text-info" : loc.location_available ? "text-safe-ink" : "text-danger-ink"}>
                  {!loc ? "Finding" : loc.location_available ? "Found" : "Missing"}
                </span>
              </span>
            </li>
            {channels.map((c) => (
              <li key={c.key} className="flex items-start gap-3 py-3">
                <c.icon size={ICON.md} strokeWidth={STROKE} className={`mt-0.5 shrink-0 ${c.state === "off" ? "text-muted" : "text-ink-2"}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={c.state === "off" ? "text-ink-2" : "font-semibold"}>{c.label}</p>
                  <p className={`text-small ${c.state === "failed" ? "text-danger-ink" : "text-muted"}`}>{c.note}</p>
                </div>
                <span className="flex items-center gap-1.5 text-small">
                  <StateIcon state={c.state} />
                  <span className={c.state === "done" ? "text-safe-ink" : c.state === "failed" ? "text-danger-ink" : c.state === "pending" ? "text-info" : "text-muted"}>
                    {STATE_WORD[c.state]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {loc?.location_available && (
          <section className="border-t border-line px-5 py-4 sm:px-8" aria-label="Map">
            {showMap ? (
              <iframe
                title="Map of your location"
                className="h-56 w-full rounded-md border border-line"
                loading="lazy"
                referrerPolicy="no-referrer"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${loc.lng - 0.006},${loc.lat - 0.004},${loc.lng + 0.006},${loc.lat + 0.004}&layer=mapnik&marker=${loc.lat},${loc.lng}`}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <button className="btn btn-quiet !px-0" onClick={() => setShowMap(true)}>
                  Show map
                </button>
                <a className="btn btn-quiet !px-0" href={loc.maps_link} target="_blank" rel="noreferrer">
                  Open in Google Maps
                </a>
              </div>
            )}
            <p className="mt-2 text-caption text-muted">The map loads only if you ask for it, so this page makes no third-party requests on its own.</p>
          </section>
        )}

        {em.warning && (
          <section className="border-t border-line px-5 py-4 sm:px-8">
            <p className="text-small text-hold">
              {em.warning}{" "}
              <button className="btn-quiet font-semibold" onClick={onOpenSetup}>
                Open setup
              </button>
            </p>
          </section>
        )}

        <section className="border-t border-line px-5 py-4 sm:px-8">
          <EmergencyNumbers />
        </section>
      </div>

      <div className="border-t border-line bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
        {safe ? (
          <button className="btn btn-secondary w-full !min-h-14" onClick={onNewSession}>
            <RotateCcw size={ICON.md} strokeWidth={STROKE} aria-hidden /> Start a new session
          </button>
        ) : (
          <button className="btn btn-safe w-full !min-h-16 text-lead" disabled={busy} onClick={onSafe}>
            <ShieldCheck size={ICON.lg} strokeWidth={STROKE} aria-hidden /> I&apos;m safe now
          </button>
        )}
      </div>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (s: string) => (s.startsWith("your ") ? "now" : s.split(" ")[0]);
function list(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
