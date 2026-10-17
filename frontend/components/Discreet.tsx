"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { discreet, quickExit } from "@/lib/api";

const NEUTRAL_TITLE = "Notes";

/** Discreet tab title and icon, plus Esc twice for Quick exit. Renders nothing. */
export function Discreet() {
  const path = usePathname();

  useEffect(() => {
    const apply = () => {
      const on = discreet.get();
      if (on) document.title = NEUTRAL_TITLE;
      else if (document.title === NEUTRAL_TITLE) document.title = "Awaaz";
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon'][data-discreet]");
      if (on) {
        if (!link) {
          link = document.createElement("link");
          link.rel = "icon";
          link.dataset.discreet = "1";
          document.head.appendChild(link);
        }
        link.href = "/notes.svg";
      } else link?.remove();
    };
    apply();
    window.addEventListener("awaaz-discreet", apply);
    return () => window.removeEventListener("awaaz-discreet", apply);
  }, [path]);

  useEffect(() => {
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const now = Date.now();
      if (now - last < 800) quickExit();
      last = now;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
