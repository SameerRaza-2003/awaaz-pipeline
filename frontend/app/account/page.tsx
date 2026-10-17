"use client";

import { Check, Eye, EyeOff, LogOut, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "register") setMode("register");
  }, []);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    // A failed attempt must never leave someone signed in as whoever used this device before.
    auth.forget();
    try {
      const r = await api<{ token: string; username: string }>(mode === "login" ? "/api/auth/login" : "/api/auth/register", { body: { username, password } });
      auth.set(r, remember);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-display font-semibold">{mode === "login" ? "Sign in" : "Create an account"}</h1>
      <p className="mt-2 text-body text-ink-2">Optional. An account saves your trusted contact, so in an emergency there is nothing to type.</p>

      <div role="tablist" aria-label="Sign in or create an account" className="mt-6 grid grid-cols-2 border-b border-line">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            type="button"
            onClick={() => {
              setMode(m);
              setErr(null);
            }}
            className={`min-h-12 border-b-2 text-body ${mode === m ? "border-ink font-semibold" : "border-transparent text-ink-2"}`}
          >
            {m === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
        <div>
          <label htmlFor="username" className="text-small font-semibold">
            Username
          </label>
          <input
            id="username"
            className="field mt-1"
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-describedby={mode === "register" ? "username-help" : undefined}
          />
          {mode === "register" && (
            <p id="username-help" className="mt-1 text-caption text-muted">
              Anything you like. It does not need to be your name.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="password" className="text-small font-semibold">
            Password
          </label>
          <div className="relative mt-1">
            <input
              id="password"
              className="field pr-12"
              type={show ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={mode === "register" ? "password-help" : undefined}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-ink-2"
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
            >
              {show ? <EyeOff size={20} strokeWidth={1.75} aria-hidden /> : <Eye size={20} strokeWidth={1.75} aria-hidden />}
            </button>
          </div>
          {mode === "register" && (
            <p id="password-help" className="mt-1 text-caption text-muted">
              At least 8 characters.
            </p>
          )}
        </div>
        <label className="flex min-h-12 items-start gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-ink" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>
            <span className="block text-body">Remember me on this device</span>
            <span className="block text-small text-ink-2">Leave this off if anyone else can use this phone.</span>
          </span>
        </label>
        {err && (
          <p className="border-l-4 border-danger pl-3 text-body text-danger-ink" role="alert">
            {err}
          </p>
        )}
        <button className="btn btn-primary w-full" disabled={busy || !username || !password}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-small text-ink-2">No email or real name is needed. Your contact details are stored encrypted. Exit signs you out at once.</p>
    </div>
  );
}

function ProfileForm({ profile, onSaved, onSignOut }: { profile: Profile; onSaved: (p: Profile) => void; onSignOut: () => void }) {
  const [displayName, setDisplayName] = useState(profile.display_name || "");
  const [name, setName] = useState(profile.trusted_contact?.name || "");
  const [phone, setPhone] = useState(profile.trusted_contact?.phone || "");
  const [discord, setDiscord] = useState("");
  const [country, setCountry] = useState(profile.country || "PK");
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
        body: { display_name: displayName, trusted_contact: { name, phone: phone || null, discord_webhook: discord || undefined }, country },
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
    <div className="mx-auto w-full max-w-xl">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <p className="label">Your account</p>
          <h1 className="mt-1 text-display font-semibold">{profile.display_name || profile.username}</h1>
          <p className="text-small text-muted">Signed in as {profile.username}</p>
        </div>
        <button className="btn btn-secondary btn-compact ml-auto" onClick={onSignOut}>
          <LogOut size={16} strokeWidth={1.75} aria-hidden /> Sign out
        </button>
      </div>

      <form onSubmit={save} className="mt-8 space-y-8">
        <fieldset className="space-y-4">
          <legend className="text-lead font-semibold">Trusted contact</legend>
          <p className="text-small text-ink-2">When you answer Yes to the danger question, this person gets your location and live updates.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="p-name" className="text-small font-semibold">
                Their name
              </label>
              <input id="p-name" className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="p-phone" className="text-small font-semibold">
                Their phone, for text and call
              </label>
              <input id="p-phone" type="tel" className="field mt-1" inputMode="tel" placeholder="03001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="p-discord" className="flex items-center gap-2 text-small font-semibold">
              Their Discord webhook (optional)
              {hasDiscord && (
                <span className="chip bg-safe-soft text-safe-ink">
                  <Check size={12} strokeWidth={2.25} aria-hidden /> saved
                </span>
              )}
            </label>
            <input
              id="p-discord"
              className="field mt-1 font-mono text-small"
              placeholder={hasDiscord ? "Paste a new URL to replace it" : "https://discord.com/api/webhooks/..."}
              value={discord}
              onChange={(e) => setDiscord(e.target.value)}
              autoComplete="off"
            />
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-lead font-semibold">About you</legend>
          <div>
            <label htmlFor="p-display" className="text-small font-semibold">
              What should we call you?
            </label>
            <input id="p-display" className="field mt-1" placeholder="Optional" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-country" className="text-small font-semibold">
              Country
            </label>
            <select id="p-country" className="field mt-1" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="PK">Pakistan</option>
              <option value="IN">India</option>
              <option value="BD">Bangladesh</option>
              <option value="GB">United Kingdom</option>
              <option value="US">United States</option>
            </select>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <Link href="/" className="btn btn-secondary">
            Go to Awaaz
          </Link>
          {msg && (
            <p className={`text-small font-semibold ${msg.ok ? "text-safe-ink" : "text-danger-ink"}`} role="status">
              {msg.text}
            </p>
          )}
        </div>
      </form>

      <section className="mt-12 border-t border-line pt-6" aria-labelledby="delete-title">
        <h2 id="delete-title" className="text-lead font-semibold">
          Delete account
        </h2>
        <p className="mt-1 text-small text-ink-2">Removes your account and saved contact. Reports you already sent are not affected.</p>
        {confirmDelete ? (
          <div className="mt-3 flex flex-wrap gap-3" role="group" aria-label="Confirm deletion">
            <button className="btn btn-secondary btn-compact border-danger text-danger-ink" onClick={remove}>
              <Trash2 size={16} strokeWidth={1.75} aria-hidden /> Yes, delete it
            </button>
            <button className="btn btn-quiet btn-compact" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-secondary btn-compact mt-3" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} strokeWidth={1.75} aria-hidden /> Delete my account
          </button>
        )}
      </section>
    </div>
  );
}

export default function AccountPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setOffline(false);
    if (!auth.token()) {
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      setProfile(await api<Profile>("/api/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) auth.forget();
      else setOffline(true); // still signed in, the server just did not answer
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Arriving from the welcome screen: after signing in, go back to the app.
  const afterAuth = async () => {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next === "/") {
      try {
        const p = await api<Profile>("/api/me");
        // New account with no contact yet: stay here so she can add one first.
        if (!p.trusted_contact) {
          setProfile(p);
          return;
        }
      } catch {}
      router.push("/");
      return;
    }
    load();
  };

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-10 sm:py-14">
      {loading ? null : offline ? (
        <div className="mx-auto w-full max-w-md" role="alert">
          <h1 className="text-title font-semibold">Can&apos;t reach Awaaz right now</h1>
          <p className="mt-2 text-body text-ink-2">You are still signed in as {auth.get()?.username}. Your account will show once the server answers.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="btn btn-primary" onClick={load}>
              Try again
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                auth.forget();
                setOffline(false);
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      ) : profile ? (
        <ProfileForm
          profile={profile}
          onSaved={setProfile}
          onSignOut={() => {
            auth.clear();
            setProfile(null);
          }}
        />
      ) : (
        <AuthForm onDone={afterAuth} />
      )}
    </div>
  );
}
