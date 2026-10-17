"use client";

import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, auth, Health, quickExit } from "@/lib/api";

const LINKS: { href: string; label: string; short?: string }[] = [
  { href: "/", label: "Home" },
  { href: "/about", label: "How it works", short: "About" },
  { href: "/police", label: "Police" },
];

function ModePill({ health, down }: { health: Health | null; down: boolean }) {
  if (down)
    return (
      <span className="rounded-full bg-danger-soft px-3 py-1.5 text-sm font-medium text-danger" role="alert">
        Server unreachable · call 15
      </span>
    );
  if (!health) return null;
  const label = health.outbound_mode === "live" ? "Live" : health.outbound_mode === "sandbox" ? "Sandbox" : "Dry run";
  const tone = health.outbound_mode === "live" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn";
  const title =
    health.outbound_mode === "dry_run"
      ? "Nothing is sent to real people"
      : health.outbound_mode === "sandbox"
        ? "Messages only go to allow-listed test recipients"
        : "Messages are sent to real recipients";
  return (
    <span className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium sm:inline-flex ${tone}`} title={title}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
      {!health.llm_configured && " · no AI key"}
    </span>
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

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-[1560px] items-center gap-1 px-3 sm:h-20 sm:gap-1.5 sm:px-6">
        <Link href="/" className="mr-1 flex shrink-0 items-center gap-3 sm:mr-8">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-ink sm:h-11 sm:w-11 sm:text-xl" aria-hidden>
            A
          </span>
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-2xl font-semibold tracking-tight">Awaaz</span>
            <span className="urdu hidden text-base leading-none text-muted sm:inline">آواز</span>
          </span>
        </Link>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-lg px-2 py-2 text-sm transition-colors sm:px-3.5 sm:py-2.5 sm:text-base ${
              path === l.href ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            {l.short ? (
              <>
                <span className="hidden sm:inline">{l.label}</span>
                <span className="sm:hidden">{l.short}</span>
              </>
            ) : (
              l.label
            )}
          </Link>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <ModePill health={health} down={down} />
          <Link
            href="/account"
            className={`btn ${path === "/account" ? "btn-ghost" : "btn-quiet"} max-sm:!min-h-9 max-sm:!px-2.5`}
            title={user ? `Signed in as ${user}` : "Optional account to save your trusted contact"}
          >
            <UserRound size={17} aria-hidden />
            <span className="hidden max-w-32 truncate sm:inline">{user ?? "Sign in"}</span>
          </Link>
          <button onClick={quickExit} className="btn btn-ghost max-sm:!min-h-9 max-sm:!px-2.5" title="Leave this site immediately and clear this session">
            <LogOut size={17} aria-hidden />
            <span className="hidden sm:inline">Quick exit</span>
            <span className="sm:hidden">Exit</span>
          </button>
        </div>
      </nav>
    </header>
  );
}
