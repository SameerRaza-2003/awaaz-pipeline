"use client";

import { Check, Loader2, Minus, TriangleAlert } from "lucide-react";

export const ICON = { sm: 16, md: 20, lg: 24 } as const;
export const STROKE = 1.75;

const URDU_RE = /[؀-ۿ]/;
export const hasUrdu = (t: string) => URDU_RE.test(t);

/** Urdu script gets lang="ur" (Nastaliq, generous leading); direction always follows the first strong character. */
export function scriptProps(text: string) {
  return hasUrdu(text) ? ({ lang: "ur", dir: "auto", className: "urdu" } as const) : ({ dir: "auto", className: "" } as const);
}

export type Msg = { role: "user" | "assistant"; text: string };

/** A conversation, not a widget: Awaaz speaks in plain text, her words sit in a quiet block on the right. */
export function Message({ m }: { m: Msg }) {
  const sp = scriptProps(m.text);
  if (m.role === "assistant")
    return (
      <div className="appear max-w-prose">
        <p className="sr-only">Awaaz:</p>
        <p {...sp} className={`whitespace-pre-wrap text-body text-ink ${sp.className}`}>
          {m.text}
        </p>
      </div>
    );
  return (
    <div className="appear flex justify-end">
      <p className="sr-only">You:</p>
      <p {...sp} className={`max-w-[85%] whitespace-pre-wrap rounded-md bg-sunken px-4 py-3 text-body text-ink ${sp.className}`}>
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

export function EmergencyNumbers({ className = "" }: { className?: string }) {
  return (
    <p className={`text-small text-ink-2 ${className}`}>
      Pakistan emergency:{" "}
      <a href="tel:15" className="font-semibold text-ink underline underline-offset-4">
        Police 15
      </a>
      {" · "}
      <a href="tel:1122" className="font-semibold text-ink underline underline-offset-4">
        Rescue 1122
      </a>
    </p>
  );
}
