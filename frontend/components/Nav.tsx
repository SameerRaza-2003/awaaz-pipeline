"use client";

import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, auth, Health, quickExit } from "@/lib/api";
import { CallLinks } from "@/components/chat/parts";

function ModeNote({ health }: { health: Health | null }) {
  if (!health || health.outbound_mode === "live") return null;
  return (
    <span
      className="hidden text-caption text-muted lg:inline"
      title={health.outbound_mode === "dry_run" ? "Nothing is sent to real people" : "Messages only go to allow-listed test recipients"}
    >
      {health.outbound_mode === "dry_run" ? "Dry run: nothing is sent" : "Sandbox: test recipients only"}
    </span>
  );
}

function DownBanner() {
  return (
    <p className="border-t border-line bg-danger-soft px-4 py-2 text-small text-danger-ink sm:px-6" role="alert">
      Awaaz cannot reach its server. If you are in danger, call <CallLinks />.
    </p>
  );
}

function Wordmark({ sub }: { sub?: string }) {
  return (
    <Link href="/" className="mr-2 flex min-h-11 items-center gap-2 sm:mr-6" aria-label="Awaaz home">
      <span className="font-heading text-title font-semibold leading-none tracking-tight">Awaaz</span>
      {sub && <span className="ml-1 border-l border-line pl-3 text-small font-semibold text-ink-2">{sub}</span>}
    </Link>
  );
}

export function Nav() {
  const path = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);
  const [user, setUser] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setUser(auth.get()?.username ?? null);
    sync();
    // A saved token can be stale (account deleted, secret rotated): check it once, drop it if refused.
    if (auth.token())
      api("/api/me").catch((e) => {
        if (e instanceof ApiError && e.status === 401) auth.forget();
      });
    window.addEventListener("awaaz-auth", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("awaaz-auth", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    api<Health>("/healthz")
      .then(setHealth)
      .catch(() => setDown(true));
  }, []);

  // The authorities tool has its own, plainer header: no survivor navigation, no Quick exit.
  if (path.startsWith("/authorities")) {
    return (
      <header className="sticky top-0 z-(--z-header) border-b border-line bg-surface">
        <nav aria-label="Authorities" className="flex h-(--header-h) items-center gap-4 px-4 lg:px-6">
          <Wordmark sub="Complaint queue" />
          <span className="ml-auto">
            <ModeNote health={health} />
          </span>
        </nav>
        {down && <DownBanner />}
      </header>
    );
  }

  const links = [
    { href: "/", label: "Home", short: "Home" },
    { href: "/about", label: "How it works", short: "About" },
  ];

  return (
    <header className="sticky top-0 z-(--z-header) border-b border-line bg-paper">
      <nav aria-label="Main" className="mx-auto flex h-(--header-h) w-full max-w-screen-2xl items-center gap-1 px-3 sm:px-6">
        <Wordmark />
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={path === l.href ? "page" : undefined}
            className={`flex min-h-11 items-center whitespace-nowrap px-2 text-small sm:px-3 ${
              path === l.href ? "font-semibold text-ink underline decoration-2 underline-offset-8" : "text-ink-2 hover:text-ink"
            }`}
          >
            <span className="hidden sm:inline">{l.label}</span>
            <span className="sm:hidden">{l.short}</span>
          </Link>
        ))}
        <Link href="/authorities" className="hidden min-h-11 items-center px-3 text-small text-ink-2 hover:text-ink lg:flex">
          Authorities dashboard
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ModeNote health={health} />
          <Link
            href="/account"
            aria-label={user ? `Account: ${user}` : "Sign in"}
            aria-current={path === "/account" ? "page" : undefined}
            className="flex min-h-11 min-w-11 items-center justify-center gap-2 px-2 text-small text-ink-2 hover:text-ink"
          >
            <UserRound size={20} strokeWidth={1.75} aria-hidden />
            <span className="hidden max-w-32 truncate sm:inline">{user ?? "Sign in"}</span>
          </Link>
          <button
            onClick={quickExit}
            className="btn btn-secondary btn-compact !min-h-11"
            title="Leaves this site at once and clears this session. Shortcut: press Esc twice."
          >
            <LogOut size={18} strokeWidth={1.75} aria-hidden />
            <span>Exit</span>
            <span className="sr-only">: leave this site now</span>
          </button>
        </div>
      </nav>
      {down && <DownBanner />}
    </header>
  );
}
