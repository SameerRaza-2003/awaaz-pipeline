"use client";

import { Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Health, Receipt as R } from "@/lib/api";
import { fmtCountdown } from "@/lib/workflow";
import { ICON, STROKE } from "./parts";

type Props = {
  receipt: R | null;
  dueAt: string | undefined;
  outcome: string | null;
  cancelled: boolean;
  now: number;
  busy: boolean;
  health: Health | null;
  onCancel: () => void;
  onFastForward: () => void;
  onNewSession: () => void;
};

export function Receipt({ receipt, dueAt, outcome, cancelled, now, busy, health, onCancel, onFastForward, onNewSession }: Props) {
  const [copied, setCopied] = useState(false);
  if (!receipt)
    return (
      <p className="flex items-center gap-3 text-lead" role="status">
        <Loader2 size={ICON.lg} strokeWidth={STROKE} className="animate-spin text-info" aria-hidden /> Sending your report…
      </p>
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(receipt.public_ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const cd = fmtCountdown(dueAt, now);

  return (
    <section className="appear space-y-6" aria-labelledby="receipt-title">
      <div>
        <p className="label !text-safe-ink">Sent</p>
        <h2 id="receipt-title" className="mt-1 text-title font-semibold">
          Your report was sent.
        </h2>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-small text-ink-2">Reference</span>
          <span className="tabular font-mono text-lead font-semibold">{receipt.public_ref}</span>
          <button className="btn btn-quiet btn-compact !px-1" onClick={copy}>
            {copied ? <Check size={ICON.sm} strokeWidth={2.25} aria-hidden /> : <Copy size={ICON.sm} strokeWidth={STROKE} aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-1 text-small text-muted">Keep this reference. It never contains your name.</p>
      </div>

      <dl className="divide-y divide-line border-y border-line">
        <div className="py-3">
          <dt className="label">Police</dt>
          <dd className="mt-1 text-body">{receipt.police_submitted ? "Your complaint is on the police dashboard." : "Submission pending."}</dd>
        </div>
        <div className="py-3">
          <dt className="label">Activist groups</dt>
          <dd className="mt-1 text-body">
            {receipt.public_on_hold ? (
              <span className="text-hold">The public summary was held back by the privacy checks. Nothing was shared publicly.</span>
            ) : receipt.no_match ? (
              "No group matched this case closely enough, so none were emailed."
            ) : receipt.communities && receipt.communities.length > 0 ? (
              <ul className="space-y-2">
                {receipt.communities.map((c) => (
                  <li key={c.name}>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold">{c.name}</span>
                      <span className="tabular shrink-0 font-mono text-caption text-muted">match {c.score.toFixed(2)}</span>
                    </span>
                    <span className="block text-small text-ink-2">{c.reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              "None."
            )}
          </dd>
        </div>
        {receipt.authority && (
          <div className="py-3">
            <dt className="label">Authority</dt>
            <dd className="mt-1 text-body">
              The social-media version was{" "}
              {receipt.authority.status === "sent" ? "emailed to" : receipt.authority.status === "dry_run" ? "prepared for (dry run)" : "queued for"} the
              relevant authority.
            </dd>
          </div>
        )}
        {(dueAt || outcome || cancelled) && (
          <div className="py-3">
            <dt className="label">News outlets</dt>
            <dd className="mt-1 text-body">
              {outcome ? (
                outcome
              ) : cancelled ? (
                "You cancelled the news escalation."
              ) : (
                <>
                  If the police record no action, the public summary goes to news outlets in{" "}
                  <span className="tabular font-mono font-semibold">{cd.text}</span>.
                  <span className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                    <button className="btn btn-quiet !px-0" disabled={busy} onClick={onCancel}>
                      Cancel news escalation
                    </button>
                    {health?.demo_routes && (
                      <button className="btn btn-quiet !px-0 text-muted" disabled={busy} onClick={onFastForward}>
                        Demo: skip to the deadline
                      </button>
                    )}
                  </span>
                </>
              )}
            </dd>
          </div>
        )}
      </dl>
      <button className="btn btn-secondary w-full" onClick={onNewSession}>
        <RotateCcw size={ICON.md} strokeWidth={STROKE} aria-hidden /> Start a new session
      </button>
    </section>
  );
}
