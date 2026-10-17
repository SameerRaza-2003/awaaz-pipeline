"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, discreet as discreetMode, SessionInfo } from "@/lib/api";

export function SetupDrawer({
  sessionId,
  open,
  onClose,
}: {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [discord, setDiscord] = useState("");
  const [hasDiscord, setHasDiscord] = useState(false);
  const [country, setCountry] = useState("PK");
  const [locale, setLocale] = useState("en");
  const [isDiscreet, setIsDiscreet] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setIsDiscreet(discreetMode.get());
    closeRef.current?.focus();
    api<SessionInfo>(`/api/sessions/${sessionId}`)
      .then((s) => {
        setCountry(s.country);
        setLocale(s.locale === "ur" ? "ur" : "en");
        setSignedIn(!!s.signed_in);
        if (s.trusted_contact) {
          setName(s.trusted_contact.is_default ? "" : s.trusted_contact.name);
          setPhone(
            s.trusted_contact.is_default ? "" : s.trusted_contact.phone || "",
          );
          setHasDiscord(
            !!s.trusted_contact.has_discord && !s.trusted_contact.is_default,
          );
        }
      })
      .catch(() => {});
  }, [open, sessionId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api(`/api/sessions/${sessionId}/settings`, {
        method: "PUT",
        body: {
          trusted_contact:
            name && (phone || discord || hasDiscord)
              ? {
                  name,
                  phone: phone || null,
                  discord_webhook: discord || undefined,
                }
              : undefined,
          country,
          locale,
        },
      });
      if (discord) {
        setHasDiscord(true);
        setDiscord("");
      }
      setMsg({ ok: true, text: "Saved for this session." });
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Could not save",
      });
    } finally {
      setSaving(false);
    }
  };

  const testDiscord = async () => {
    try {
      const r = await api<{ status: string; error?: string }>(
        `/api/sessions/${sessionId}/discord-test`,
        { body: {} },
      );
      setMsg(
        r.status === "sent"
          ? { ok: true, text: "Test message posted to Discord." }
          : r.status === "dry_run"
            ? { ok: false, text: "Dry run: the test was logged, not posted." }
            : {
                ok: false,
                text: `Discord: ${r.status}${r.error ? ` (${r.error})` : ""}`,
              },
      );
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Test failed",
      });
    }
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-(--z-overlay) flex justify-end bg-scrim"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        className="appear flex h-full w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={save}
          className="flex h-full w-full flex-col bg-surface shadow-overlay"
        >
          <div className="flex min-h-16 items-center border-b border-line px-5">
            <div>
              <h2 id="setup-title" className="text-title font-semibold">
                Setup
              </h2>
              <p className="text-caption text-muted">
                Saved for this session only.
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="btn btn-quiet !min-h-12 !w-12 ml-auto !px-0 !no-underline"
              onClick={onClose}
              aria-label="Close setup"
            >
              <X size={22} strokeWidth={1.75} aria-hidden />
            </button>
          </div>

          <div className="scroll-thin min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-6">
            <fieldset className="space-y-4">
              <legend className="text-lead font-semibold">
                Trusted contact
              </legend>
              <p className="text-small text-ink-2">
                If you answer Yes to the danger question, this person gets your
                location and live updates.
              </p>
              {signedIn ? (
                <p className="text-small text-ink-2">
                  Your account&apos;s saved contact is used by default. Changes
                  here apply to this session only;{" "}
                  <a
                    href="/account"
                    className="font-semibold underline underline-offset-4"
                  >
                    edit your account
                  </a>{" "}
                  to change it for good.
                </p>
              ) : (
                <p className="text-small text-ink-2">
                  <a
                    href="/account"
                    className="font-semibold underline underline-offset-4"
                  >
                    A free account
                  </a>{" "}
                  saves this so you never have to type it in an emergency. No
                  email needed.
                </p>
              )}
              <div>
                <label htmlFor="tc-name" className="text-small font-semibold">
                  Their name
                </label>
                <input
                  id="tc-name"
                  className="field mt-1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="tc-phone" className="text-small font-semibold">
                  Their phone, for text and call
                </label>
                <input
                  id="tc-phone"
                  type="tel"
                  className="field mt-1"
                  placeholder="03001234567"
                  inputMode="tel"
                  autoComplete="off"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-describedby="tc-phone-help"
                />
                <p id="tc-phone-help" className="mt-1 text-caption text-muted">
                  Local or international format both work.
                </p>
              </div>
              <div>
                <label
                  htmlFor="tc-discord"
                  className="flex items-center gap-2 text-small font-semibold"
                >
                  Their Discord webhook (optional)
                  {hasDiscord && (
                    <span className="chip bg-safe-soft text-safe-ink">
                      <Check size={12} strokeWidth={2.25} aria-hidden /> saved
                    </span>
                  )}
                </label>
                <input
                  id="tc-discord"
                  className="field mt-1 font-mono text-small"
                  placeholder={
                    hasDiscord
                      ? "Paste a new URL to replace it"
                      : "https://discord.com/api/webhooks/..."
                  }
                  value={discord}
                  onChange={(e) => setDiscord(e.target.value)}
                  autoComplete="off"
                />
                <details className="mt-2 text-small text-ink-2">
                  <summary className="min-h-10 font-semibold">
                    How they get a webhook
                  </summary>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>
                      They create a private Discord channel and turn on its
                      notifications.
                    </li>
                    <li>
                      Edit channel, then Integrations, then Webhooks, then New
                      webhook.
                    </li>
                    <li>They copy the webhook URL and send it to you.</li>
                  </ol>
                </details>
                {hasDiscord && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact mt-2"
                    onClick={testDiscord}
                  >
                    Send a test message
                  </button>
                )}
              </div>
            </fieldset>

            <fieldset className="grid grid-cols-2 gap-4">
              <legend className="mb-2 text-lead font-semibold">Region</legend>
              <div>
                <label
                  htmlFor="set-country"
                  className="text-small font-semibold"
                >
                  Country
                </label>
                <select
                  id="set-country"
                  className="field mt-1"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  <option value="PK">Pakistan</option>
                  <option value="IN">India</option>
                  <option value="BD">Bangladesh</option>
                  <option value="GB">United Kingdom</option>
                  <option value="US">United States</option>
                </select>
              </div>
              <div>
                <label htmlFor="set-lang" className="text-small font-semibold">
                  Language
                </label>
                <select
                  id="set-lang"
                  className="field mt-1"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                >
                  <option value="en">English</option>
                  <option value="ur">اردو</option>
                </select>
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-lead font-semibold">
                Privacy on this device
              </legend>
              <label className="mt-3 flex min-h-12 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 accent-ink"
                  checked={isDiscreet}
                  onChange={(e) => {
                    setIsDiscreet(e.target.checked);
                    discreetMode.set(e.target.checked);
                  }}
                />
                <span>
                  <span className="block text-body font-semibold">
                    Discreet tab
                  </span>
                  <span className="block text-small text-ink-2">
                    Shows &quot;Notes&quot; and a plain icon in the browser tab
                    instead of Awaaz.
                  </span>
                </span>
              </label>
              <p className="mt-3 text-small text-ink-2">
                Press Esc twice, or use Exit at the top, to leave this site at
                once.
              </p>
            </fieldset>

            {msg && (
              <p
                className={`text-small font-semibold ${msg.ok ? "text-safe-ink" : "text-hold"}`}
                role="status"
              >
                {msg.text}
              </p>
            )}
          </div>

          <div className="border-t border-line px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
            <button className="btn btn-primary w-full" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
