"use client";

import { Fragment } from "react";
import { Check, Loader2, Minus, TriangleAlert } from "lucide-react";
import { useEmergency } from "@/lib/emergency";

export const ICON = { sm: 16, md: 20, lg: 24 } as const;
export const STROKE = 1.75;

export type Msg = { role: "user" | "assistant"; text: string };

/** A conversation, not a widget: Awaaz speaks in plain text, her words sit in a quiet block on the right. */
export function Message({ m }: { m: Msg }) {
  if (m.role === "assistant")
    return (
      <div className="appear max-w-prose">
        <p className="sr-only">Awaaz:</p>
        <p dir="auto" className="whitespace-pre-wrap text-body text-ink">
          {m.text}
        </p>
      </div>
    );
  return (
    <div className="appear flex justify-end">
      <p className="sr-only">You:</p>
      <p dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-md bg-sunken px-4 py-3 text-body text-ink">
        {m.text}
      </p>
    </div>
  );
}

export type RowState = "pending" | "done" | "failed" | "off";

export function StateIcon({ state, size = ICON.md }: { state: RowState; size?: number }) {
  if (state === "pending") return <Loader2 size={size} strokeWidth={STROKE} className="animate-spin text-info" aria-hidden />;
  if (state === "done") return <Check size={size} strokeWidth={2.25} className="text-safe-ink" aria-hidden />;
  if (state === "failed") return <TriangleAlert size={size} strokeWidth={STROKE} className="text-danger-ink" aria-hidden />;
  return <Minus size={size} strokeWidth={STROKE} className="text-muted" aria-hidden />;
}

export const STATE_WORD: Record<RowState, string> = {
  pending: "Sending",
  done: "Sent",
  failed: "Failed",
  off: "Not set up",
};

export function ago(iso: string | undefined | null, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

export function clock(iso: string | undefined | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function Typing({ label = "Awaaz is writing" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-small text-muted" role="status">
      <span className="typing flex gap-1" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      {label}
    </div>
  );
}

/** Local emergency numbers, chosen from the phone's time zone (112 when unknown). */
export function EmergencyNumbers({ className = "" }: { className?: string }) {
  const { primary } = useEmergency();
  return (
    <p className={`text-small text-ink-2 ${className}`}>
      In an emergency:{" "}
      {primary.map((n, i) => (
        <Fragment key={n.number}>
          {i > 0 && " · "}
          <a href={`tel:${n.number}`} className="font-semibold text-ink underline underline-offset-4">
            {n.label} {n.number}
          </a>
        </Fragment>
      ))}
    </p>
  );
}

/** Inline "15 (Police) or 1122 (Rescue)" for sentences that start with "call". */
export function CallLinks() {
  const { primary } = useEmergency();
  return (
    <>
      {primary.map((n, i) => (
        <Fragment key={n.number}>
          {i > 0 && " or "}
          <a href={`tel:${n.number}`} className="font-semibold underline underline-offset-4">
            {n.number} ({n.label})
          </a>
        </Fragment>
      ))}
    </>
  );
}
