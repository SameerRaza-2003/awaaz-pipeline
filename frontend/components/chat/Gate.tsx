"use client";

import { Loader2, MapPinOff, Phone, UserRoundX } from "lucide-react";
import { EmergencyNumbers, ICON, STROKE } from "./parts";
import { useEmergency } from "@/lib/emergency";

export type HelpProps = {
  contactName: string | null;
  onOpenSetup: () => void;
  armed: number | null;
  onSendNow: () => void;
  onCancelArmed: () => void;
  noContact: boolean;
  onCloseNoContact: () => void;
  locating: boolean;
  locDenied: { seconds: number; reason: string } | null;
  locText: string;
  setLocText: (v: string) => void;
  onSendWithoutLocation: () => void;
};

export const helpActive = (p: HelpProps) => p.armed !== null || p.noContact || p.locating || !!p.locDenied;

/** Countdown, no-contact fallback and location problems: shared by the gate and the "Get help now" shortcut. */
export function HelpStates(p: HelpProps) {
  if (p.armed !== null) return <Countdown seconds={p.armed} contactName={p.contactName} onSendNow={p.onSendNow} onCancel={p.onCancelArmed} />;
  if (p.noContact) return <NoContact onOpenSetup={p.onOpenSetup} onBack={p.onCloseNoContact} />;
  if (p.locating)
    return (
      <p className="flex min-h-16 items-center gap-3 text-lead" role="status">
        <Loader2 size={ICON.lg} strokeWidth={STROKE} className="animate-spin text-info" aria-hidden /> Finding your location…
      </p>
    );
  if (p.locDenied) return <LocationProblem {...p} />;
  return null;
}

type Props = HelpProps & {
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
};

/** The first and most important screen: one question, two answers within thumb reach. */
export function Gate(p: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center px-5 pb-6 pt-8 sm:px-8">
        <p className="label">Private and anonymous</p>
        <h1 className="mt-3 text-display font-semibold sm:text-hero">Are you in danger right now?</h1>
      </div>

      <div className="border-t border-line bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-8">
        {helpActive(p) ? (
          <HelpStates {...p} />
        ) : (
          <div className="space-y-3">
            <button className="btn btn-danger w-full !min-h-16 text-lead" disabled={p.busy} onClick={p.onYes}>
              Yes, I need help now
            </button>
            <button className="btn btn-secondary w-full !min-h-14" disabled={p.busy} onClick={p.onNo}>
              No, I want to report
            </button>
            <p className="pt-1 text-small text-ink-2">
              {p.contactName ? (
                <>Yes sends your location to {p.contactName} straight away.</>
              ) : (
                <>
                  Yes sends your location to your trusted contact.{" "}
                  <button className="btn-quiet font-semibold" onClick={p.onOpenSetup}>
                    Add one now
                  </button>
                </>
              )}
            </p>
            <EmergencyNumbers />
          </div>
        )}
      </div>
    </div>
  );
}

function Countdown({ seconds, contactName, onSendNow, onCancel }: { seconds: number; contactName: string | null; onSendNow: () => void; onCancel: () => void }) {
  return (
    <div className="space-y-4" role="alert">
      <div className="flex items-center gap-4">
        <span className="tabular flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-danger font-heading text-display text-on-fill">
          {seconds}
        </span>
        <p className="text-lead">
          Alerting {contactName ?? "your trusted contact"} in {seconds} second{seconds === 1 ? "" : "s"}.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button className="btn btn-danger !min-h-14" onClick={onSendNow}>
          Send now
        </button>
        <button className="btn btn-secondary !min-h-14" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function NoContact({ onOpenSetup, onBack }: { onOpenSetup: () => void; onBack: () => void }) {
  const emergency = useEmergency();
  return (
    <div className="space-y-4" role="alert">
      <div className="flex items-start gap-3">
        <UserRoundX size={ICON.lg} strokeWidth={STROKE} className="mt-0.5 shrink-0 text-danger-ink" aria-hidden />
        <div>
          <p className="text-lead font-semibold">No trusted contact is set up, so no one can be alerted for you.</p>
          <p className="mt-1 text-body text-ink-2">Call for help directly from this phone:</p>
        </div>
      </div>
      <div className={`grid gap-3 ${emergency.primary.length > 1 ? "grid-cols-2" : ""}`}>
        {emergency.primary.map((n) => (
          <a key={n.number} className="btn btn-danger !min-h-14" href={`tel:${n.number}`}>
            <Phone size={ICON.md} strokeWidth={STROKE} aria-hidden /> {n.label} {n.number}
          </a>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6">
        <button className="btn btn-quiet !px-0" onClick={onOpenSetup}>
          Add a trusted contact
        </button>
        <button className="btn btn-quiet !px-0" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function LocationProblem(p: HelpProps) {
  const d = p.locDenied!;
  return (
    <div className="space-y-3" role="alert">
      <div className="flex items-start gap-3">
        <MapPinOff size={ICON.lg} strokeWidth={STROKE} className="mt-0.5 shrink-0 text-hold" aria-hidden />
        <div>
          <p className="text-lead font-semibold">Your location could not be found</p>
          <p className="mt-1 text-small text-ink-2">{d.reason}</p>
        </div>
      </div>
      <label className="block">
        <span className="text-small font-semibold">Where are you? (optional)</span>
        <input
          className="field mt-1"
          dir="auto"
          placeholder="Near Liberty Market, Gulberg"
          value={p.locText}
          onChange={(e) => p.setLocText(e.target.value)}
        />
      </label>
      <button className="btn btn-danger w-full !min-h-14" onClick={p.onSendWithoutLocation}>
        Send the alert now
      </button>
      <p className="tabular text-center text-small text-muted">The alert goes out by itself in {d.seconds} s.</p>
    </div>
  );
}
