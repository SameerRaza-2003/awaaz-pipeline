"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, Health, quickExit } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/police", label: "Police" },
];

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
    <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur border-b border-line">
      {health && health.outbound_mode !== "live" && (
        <div className="bg-warn-soft text-warn text-sm px-4 py-1.5 text-center" role="status">
          <strong>Demo mode ({health.outbound_mode === "dry_run" ? "dry run" : "sandbox"}):</strong>{" "}
          {health.outbound_mode === "dry_run"
            ? "nothing is sent to real people."
            : "messages go only to allow-listed test numbers and inboxes."}
          {!health.llm_configured && " LLM key not set: agents fall back to fixed templates."}
        </div>
      )}
      {down && (
        <div className="bg-danger-soft text-danger text-sm px-4 py-1.5 text-center" role="alert">
          Cannot reach the Awaaz server. In an emergency call 15 (Police) or 1122 (Rescue).
        </div>
      )}
      <nav className="mx-auto max-w-[1500px] flex items-center gap-2 px-4 h-14">
        <Link href="/" className="font-bold text-lg tracking-tight text-accent mr-1 sm:mr-4">
          Awaaz <span className="font-normal text-muted text-sm hidden sm:inline">آواز</span>
        </Link>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`px-3 py-2 rounded-lg text-sm ${path === l.href ? "bg-surface-2 font-semibold" : "text-ink-2 hover:bg-surface-2"}`}
          >
            {l.label}
          </Link>
        ))}
        <button onClick={quickExit} className="ml-auto btn btn-ghost !min-h-9 !py-1.5 text-sm whitespace-nowrap" title="Leave this site immediately">
          <span className="hidden sm:inline">Quick exit</span><span className="sm:hidden">Exit</span> ✕
        </button>
      </nav>
    </header>
  );
}
