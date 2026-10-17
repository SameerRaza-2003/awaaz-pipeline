"use client";

import { Check, LogOut, ShieldCheck, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, auth } from "@/lib/api";

type Profile = {
  username: string;
  display_name: string | null;
  trusted_contact: { name: string; phone: string | null; has_discord: boolean } | null;
  country: string | null;
  locale: string | null;
};

function AuthForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string; username: string }>(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        body: { username, password },
      });
      auth.set(r, remember);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{mode === "login" ? "Sign in" : "Create an account"}</h1>
        <p className="text-sm text-ink-2">
          Optional. An account saves your trusted contact so help is one tap away. You can always use Awaaz without one.
        </p>
      </div>
      <div className="grid grid-cols-2 rounded-lg border border-line p-1 text-sm">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setErr(null);
            }}
            className={`rounded-md py-1.5 ${mode === m ? "bg-surface-3 font-medium" : "text-ink-2"}`}
          >
            {m === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="card space-y-3 p-5">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-2">Username</span>
          <input className="field" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
          {mode === "register" && <span className="block text-xs text-muted">Anything you like. It does not need to be your name.</span>}
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-ink-2">Password</span>
          <input
            className="field"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "register" && <span className="block text-xs text-muted">At least 8 characters.</span>}
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>
            Remember me on this device
            <span className="block text-xs text-muted">Leave this off if someone else can use this phone.</span>
          </span>
        </label>
        {err && <p className="rounded-lg bg-danger-soft p-2.5 text-sm text-danger">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy || !username || !password}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <ul className="space-y-1.5 text-xs text-muted">
        <li className="flex gap-2">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" /> No email or real name needed. Your contact details are stored encrypted.
        </li>
        <li className="flex gap-2">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" /> Quick exit signs you out instantly.
        </li>
      </ul>
    </div>
  );
}

function ProfileForm({ profile, onSaved, onSignOut }: { profile: Profile; onSaved: (p: Profile) => void; onSignOut: () => void }) {
  const [displayName, setDisplayName] = useState(profile.display_name || "");
  const [name, setName] = useState(profile.trusted_contact?.name || "");
  const [phone, setPhone] = useState(profile.trusted_contact?.phone || "");
  const [discord, setDiscord] = useState("");
  const [country, setCountry] = useState(profile.country || "PK");
  const [locale, setLocale] = useState(profile.locale || "en");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasDiscord = !!profile.trusted_contact?.has_discord;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const p = await api<Profile>("/api/me", {
        method: "PUT",
        body: { display_name: displayName, trusted_contact: { name, phone: phone || null, discord_webhook: discord || undefined }, country, locale },
      });
      setDiscord("");
      onSaved(p);
      setMsg({ ok: true, text: "Saved. New sessions will use this contact." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await api("/api/me", { method: "DELETE" }).catch(() => {});
    onSignOut();
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
          <UserRound size={18} />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{profile.display_name || profile.username}</h1>
          <p className="text-xs text-muted">Signed in as {profile.username}</p>
        </div>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onSignOut}>
          <LogOut size={14} /> Sign out
        </button>
      </div>

      <form onSubmit={save} className="card divide-y divide-line">
        <fieldset className="space-y-3 p-5">
          <legend className="mb-1 text-sm font-semibold">Trusted contact</legend>
          <p className="text-xs text-muted">When you press “Yes, I need help”, this person gets your location and live updates.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-2">Their name</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-2">Their phone (calls and SMS)</span>
              <input className="field" inputMode="tel" placeholder="03001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="flex items-center gap-2 text-xs font-medium text-ink-2">
              Their Discord webhook (optional)
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
        </fieldset>

        <div className="grid gap-3 p-5 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-2">What should we call you?</span>
            <input className="field" placeholder="Optional" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
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

        <div className="flex flex-wrap items-center gap-3 p-5">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <Link href="/" className="btn btn-ghost">
            Go to Awaaz
          </Link>
          {msg && <p className={`text-sm ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
        </div>
      </form>

      <div className="card p-5">
        <h2 className="text-sm font-semibold">Delete account</h2>
        <p className="mt-1 text-xs text-muted">Removes your account and saved contact. Reports you already sent are not affected.</p>
        {confirmDelete ? (
          <div className="mt-3 flex gap-2">
            <button className="btn btn-danger btn-sm" onClick={remove}>
              <Trash2 size={14} /> Yes, delete it
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm mt-3" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Delete my account
          </button>
        )}
      </div>
    </div>
  );
}

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    if (!auth.token()) {
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      setProfile(await api<Profile>("/api/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) auth.clear();
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:py-12">
      {loading ? null : profile ? (
        <ProfileForm
          profile={profile}
          onSaved={setProfile}
          onSignOut={() => {
            auth.clear();
            setProfile(null);
          }}
        />
      ) : (
        <AuthForm onDone={load} />
      )}
    </div>
  );
}
