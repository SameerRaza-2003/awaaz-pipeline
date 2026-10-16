"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, Health, quickExit } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "How it works" },
  { href: "/police", label: "Police" },
];

function ModePill({ health, down }: { health: Health | null; down: boolean }) {
  if (down)
    return (
      <span className="rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger" role="alert">
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
    <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${tone}`} title={title}>
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

  useEffect(() => {
    api<Health>("/healthz")
      .then(setHealth)
      .catch(() => setDown(true));
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-[1560px] items-center gap-1 px-3 sm:px-5">
        <Link href="/" className="mr-3 flex items-baseline gap-2 sm:mr-6">
          <span className="text-[1.05rem] font-semibold tracking-tight">Awaaz</span>
          <span className="urdu hidden text-sm leading-none text-muted sm:inline">آواز</span>
        </Link>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
              path === l.href ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            {l.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <ModePill health={health} down={down} />
          <button onClick={quickExit} className="btn btn-ghost btn-sm" title="Leave this site immediately and clear this session">
            <LogOut size={15} aria-hidden />
            <span className="hidden sm:inline">Quick exit</span>
            <span className="sm:hidden">Exit</span>
          </button>
        </div>
      </nav>
    </header>
  );
}
