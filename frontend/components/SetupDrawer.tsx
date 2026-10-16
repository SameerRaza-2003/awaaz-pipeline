"use client";

import { useEffect, useState } from "react";
import { api, SessionInfo } from "@/lib/api";

export function SetupDrawer({ sessionId, open, onClose }: { sessionId: string; open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("PK");
  const [locale, setLocale] = useState("en");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    api<SessionInfo>(`/api/sessions/${sessionId}`)
      .then((s) => {
        setCountry(s.country);
        setLocale(s.locale);
        if (s.trusted_contact) {
          setName(s.trusted_contact.name);
          setPhone(s.trusted_contact.phone);
        }
      })
      .catch(() => {});
  }, [open, sessionId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/api/sessions/${sessionId}/settings`, {
        method: "PUT",
        body: { trusted_contact: name && phone ? { name, phone } : undefined, country, locale },
      });
      setMsg("Saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not save");
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-sm space-y-4 overflow-y-auto bg-surface p-5 shadow-xl"
        aria-label="Setup"
      >
        <div className="flex items-center">
          <h2 className="text-lg font-semibold">Setup</h2>
          <button type="button" className="ml-auto btn btn-ghost !min-h-9 !py-1" onClick={onClose}>
            Close
          </button>
        </div>
        <fieldset className="space-y-2">
          <legend className="font-semibold">Trusted contact</legend>
          <p className="text-xs text-muted">Gets your location by SMS and a phone call if you press “Yes, I’m in danger”.</p>
          <input className="field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="field" placeholder="+923001234567" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </fieldset>
        <label className="block space-y-1">
          <span className="font-semibold">Country</span>
          <select className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="PK">Pakistan</option>
            <option value="IN">India</option>
            <option value="BD">Bangladesh</option>
            <option value="GB">United Kingdom</option>
            <option value="US">United States</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-semibold">Language</span>
          <select className="field" value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en">English</option>
            <option value="ur">اردو (Urdu)</option>
          </select>
        </label>
        <button className="btn btn-primary w-full">Save</button>
        {msg && <p className="text-sm" role="status">{msg}</p>}
      </form>
    </div>
  );
}
