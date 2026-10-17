"use client";

import { Check, Clock, EyeOff, Globe2, Lock, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Drafts } from "@/lib/api";
import { ICON, STROKE } from "./parts";

export type PrivacyEvidence = { identifiers: number | null; reviewed: boolean | null; scans: number };

type Props = {
  drafts: Drafts;
  policeText: string;
  setPoliceText: (v: string) => void;
  privacy: PrivacyEvidence;
  busy: boolean;
  revise: { target: "public" | "police"; text: string } | null;
  setRevise: (r: { target: "public" | "police"; text: string } | null) => void;
  onRevise: () => void;
  onConfirm: () => void;
};

export function Review({ drafts, policeText, setPoliceText, privacy, busy, revise, setRevise, onRevise, onConfirm }: Props) {
  const [confirming, setConfirming] = useState(false);
  const clean = drafts.public_clean;

  return (
    <div className="appear space-y-8">
      <div>
        <h2 className="text-title font-semibold">Read both versions before anything is sent</h2>
        <p className="mt-1 text-body text-ink-2">One goes only to the police. The other can be shared, and contains nothing that identifies you.</p>
      </div>

      <section aria-labelledby="police-version" className="border-l-4 border-ink pl-4">
        <div className="flex items-start gap-3">
          <Lock size={ICON.md} strokeWidth={STROKE} className="mt-1 shrink-0" aria-hidden />
          <div>
            <h3 id="police-version" className="text-lead font-semibold">
              Police complaint
            </h3>
            <p className="text-small text-ink-2">
              <strong>Private.</strong> Only the police dashboard sees this. It includes your name, contact and every detail you gave.
            </p>
          </div>
        </div>
        <label htmlFor="police-text" className="sr-only">
          Police complaint text, editable
        </label>
        <textarea
          id="police-text"
          dir="auto"
          className="field mt-3 min-h-64 resize-y text-small leading-relaxed"
          value={policeText}
          onChange={(e) => setPoliceText(e.target.value)}
        />
        <p className="mt-1 text-caption text-muted">You can edit this text directly.</p>
        <button className="btn btn-quiet mt-1 !px-0" onClick={() => setRevise({ target: "police", text: "" })}>
          Ask Awaaz to rewrite it
        </button>
      </section>

      <section aria-labelledby="public-version" className="border-l-4 border-line-strong pl-4">
        <div className="flex items-start gap-3">
          <Globe2 size={ICON.md} strokeWidth={STROKE} className="mt-1 shrink-0" aria-hidden />
          <div>
            <h3 id="public-version" className="text-lead font-semibold">
              Public summary
            </h3>
            <p className="text-small text-ink-2">
              <strong>Shareable.</strong> Goes to matched activist groups now, and to news outlets only if the police take no action within 24 hours.
            </p>
          </div>
        </div>

        {clean ? (
          <p className="mt-3 whitespace-pre-wrap rounded-md bg-sunken p-4 text-body">{drafts.public_text}</p>
        ) : (
          <div className="mt-3 flex items-start gap-3 rounded-md bg-hold-soft p-4 text-body text-hold" role="status">
            <TriangleAlert size={ICON.md} strokeWidth={STROKE} className="mt-0.5 shrink-0" aria-hidden />
            <p>
              <strong>On hold.</strong> The privacy checks could not confirm this summary is free of personal details, so it will not be shared. Your
              police complaint can still be sent. You can ask for a change and try again.
            </p>
          </div>
        )}

        <dl className="mt-4 space-y-2 text-small">
          <div className="flex items-start gap-2">
            <dt className="sr-only">Personal details found</dt>
            <EyeOff size={ICON.sm} strokeWidth={STROKE} className="mt-1 shrink-0 text-ink-2" aria-hidden />
            <dd>
              {privacy.identifiers === null
                ? "Your account was read for anything that could identify you."
                : privacy.identifiers === 0
                  ? "No names, numbers or places that could identify you were found in your account."
                  : `${privacy.identifiers} identifying detail${privacy.identifiers === 1 ? "" : "s"} from your account (names, numbers, places) were kept out of this summary.`}
            </dd>
          </div>
          <div className="flex items-start gap-2">
            <dt className="sr-only">Automatic checks</dt>
            {clean ? (
              <Check size={ICON.sm} strokeWidth={2.25} className="mt-1 shrink-0 text-safe-ink" aria-hidden />
            ) : (
              <TriangleAlert size={ICON.sm} strokeWidth={STROKE} className="mt-1 shrink-0 text-hold" aria-hidden />
            )}
            <dd>
              {clean
                ? "Passed two checks: a scanner for phone numbers, emails, ID and plate numbers and addresses, and a second, independent read for anything identifying."
                : "Did not pass the privacy checks."}
            </dd>
          </div>
        </dl>
        <button className="btn btn-quiet mt-2 !px-0" onClick={() => setRevise({ target: "public", text: "" })}>
          Request a change
        </button>
      </section>

      {revise && (
        <section className="space-y-2" aria-label="Request a change">
          <label className="block text-body font-semibold" htmlFor="revise">
            What should change in the {revise.target === "police" ? "police complaint" : "public summary"}?
          </label>
          <textarea id="revise" className="field text-body" dir="auto" rows={3} value={revise.text} onChange={(e) => setRevise({ ...revise, text: e.target.value })} />
          <div className="flex gap-3">
            <button className="btn btn-primary flex-1" disabled={busy || !revise.text.trim()} onClick={onRevise}>
              Rewrite
            </button>
            <button className="btn btn-secondary" onClick={() => setRevise(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      <section aria-labelledby="next-steps">
        <h3 id="next-steps" className="label">
          What happens when you send
        </h3>
        <ol className="mt-2 space-y-2 text-body">
          <li className="flex gap-3">
            <span className="tabular font-mono text-muted">1</span>The police dashboard receives the full complaint.
          </li>
          {clean && (
            <li className="flex gap-3">
              <span className="tabular font-mono text-muted">2</span>Activist groups working on cases like yours receive the public summary.
            </li>
          )}
          {clean && (
            <li className="flex gap-3">
              <span className="tabular font-mono text-muted">3</span>
              <span>
                If the police record no action within 24 hours, news outlets receive the public summary. You can cancel this.
                <Clock size={ICON.sm} strokeWidth={STROKE} className="ml-1 inline text-muted" aria-hidden />
              </span>
            </li>
          )}
        </ol>
      </section>

      <div className="sticky bottom-0 -mx-5 -mb-6 border-t border-line bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:-mx-8 sm:px-8">
        {confirming ? (
          <div className="space-y-3" role="group" aria-label="Confirm sending">
            <p className="text-body">
              <strong>Send now?</strong> This cannot be undone. {clean ? "The police and matched groups will receive it." : "Only the police will receive it."}
            </p>
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <button className="btn btn-primary !min-h-14" disabled={busy} onClick={onConfirm}>
                <Send size={ICON.md} strokeWidth={STROKE} aria-hidden /> Send report
              </button>
              <button className="btn btn-secondary !min-h-14" onClick={() => setConfirming(false)}>
                Not yet
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-primary w-full !min-h-14" disabled={busy} onClick={() => setConfirming(true)}>
            {clean ? "Review and send to police and groups" : "Review and send to police only"}
          </button>
        )}
      </div>
    </div>
  );
}
