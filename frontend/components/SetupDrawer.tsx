"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, SessionInfo } from "@/lib/api";

export function SetupDrawer({ sessionId, open, onClose }: { sessionId: string; open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [discord, setDiscord] = useState("");
  const [hasDiscord, setHasDiscord] = useState(false);
  const [country, setCountry] = useState("PK");
  const [locale, setLocale] = useState("en");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    api<SessionInfo>(`/api/sessions/${sessionId}`)
      .then((s) => {
        setCountry(s.country);
        setLocale(s.locale);
        if (s.trusted_contact) {
          setName(s.trusted_contact.name);
          setPhone(s.trusted_contact.phone || "");
          setHasDiscord(!!s.trusted_contact.has_discord);
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
          trusted_contact: name && (phone || discord || hasDiscord) ? { name, phone: phone || null, discord_webhook: discord || undefined } : undefined,
          country,
          locale,
        },
      });
      if (discord) {
        setHasDiscord(true);
        setDiscord("");
      }
      setMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  };

  const testDiscord = async () => {
    try {
      const r = await api<{ status: string; error?: string }>(`/api/sessions/${sessionId}/discord-test`, { body: {} });
      setMsg(
        r.status === "sent"
          ? { ok: true, text: "Test message posted to Discord." }
          : r.status === "dry_run"
            ? { ok: false, text: "Dry-run mode: the test was logged, not posted. Use OUTBOUND_MODE=sandbox with discord:* in OUTBOUND_ALLOWLIST to post for real." }
            : { ok: false, text: `Discord: ${r.status}${r.error ? ` (${r.error})` : ""}` },
      );
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Test failed" });
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="rise flex h-full w-full max-w-md flex-col bg-surface shadow-2xl"
        aria-label="Setup"
      >
        <div className="flex items-center border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold">Setup</h2>
            <p className="text-xs text-muted">Saved for this session only.</p>
          </div>
          <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-semibold">Trusted contact</legend>
            <p className="text-xs text-muted">If you press “Yes, I need help”, this person gets your location and live updates.</p>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-2">Name</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-2">Phone (SMS and call)</span>
              <input className="field" placeholder="+923001234567" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="flex items-center gap-2 text-xs font-medium text-ink-2">
                Discord webhook
                {hasDiscord && (
                  <span className="inline-flex items-center gap-1 rounded bg-ok-soft px-1.5 py-0.5 text-[10px] text-ok">
                    <Check size={10} /> saved
                  </span>
                )}
              </span>
              <input
                className="field font-mono text-xs"
                placeholder={hasDiscord ? "Paste a new URL to replace the saved one" : "https://discord.com/api/webhooks/..."}
                value={discord}
                onChange={(e) => setDiscord(e.target.value)}
                autoComplete="off"
              />
            </label>
            <details className="text-xs text-muted">
              <summary className="cursor-pointer text-ink-2">How your contact gets a webhook</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>Create a private Discord channel and turn on its notifications.</li>
                <li>Edit channel, then Integrations, then Webhooks, then New webhook.</li>
                <li>Copy the webhook URL and send it to you.</li>
              </ol>
            </details>
            {hasDiscord && (
              <button type="button" className="btn btn-ghost btn-sm w-full" onClick={testDiscord}>
                Send a test message to Discord
              </button>
            )}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-2">Country</span>
              <select className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="PK">Pakistan</option>
                <option value="IN">India</option>
                <option value="BD">Bangladesh</option>
                <option value="GB">United Kingdom</option>
                <option value="US">United States</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-2">Language</span>
              <select className="field" value={locale} onChange={(e) => setLocale(e.target.value)}>
                <option value="en">English</option>
                <option value="ur">اردو</option>
              </select>
            </label>
          </div>

          {msg && (
            <p className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`} role="status">
              {msg.text}
            </p>
          )}
        </div>

        <div className="border-t border-line p-4">
          <button className="btn btn-primary w-full" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
