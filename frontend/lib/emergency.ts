"use client";

import { useEffect, useState } from "react";

export type Num = { number: string; label: string };
export type Region = { primary: Num[]; helplines: Num[] };

/** 112 reaches emergency services from most mobile phones worldwide; used when the region is unknown. */
const DEFAULT: Region = { primary: [{ number: "112", label: "Emergency" }], helplines: [] };

const REGIONS: Record<string, Region> = {
  PK: {
    primary: [
      { number: "15", label: "Police" },
      { number: "1122", label: "Rescue" },
    ],
    helplines: [
      { number: "1099", label: "Human rights helpline" },
      { number: "1098", label: "Women and children helpline" },
    ],
  },
  IN: { primary: [{ number: "112", label: "Emergency" }], helplines: [{ number: "181", label: "Women helpline" }] },
  BD: { primary: [{ number: "999", label: "Emergency" }], helplines: [{ number: "109", label: "Violence against women helpline" }] },
  GB: { primary: [{ number: "999", label: "Emergency" }], helplines: [{ number: "08082000247", label: "National Domestic Abuse Helpline" }] },
  US: { primary: [{ number: "911", label: "Emergency" }], helplines: [{ number: "18007997233", label: "National Domestic Violence Hotline" }] },
  CA: { primary: [{ number: "911", label: "Emergency" }], helplines: [] },
  AU: { primary: [{ number: "000", label: "Emergency" }], helplines: [{ number: "1800737732", label: "1800RESPECT" }] },
  EU: DEFAULT,
};

/** The phone's time zone says where it is, which is more reliable than the browser language (often en-US everywhere). */
function regionFromTimeZone(tz: string): string | null {
  if (tz === "Asia/Karachi") return "PK";
  if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "IN";
  if (tz === "Asia/Dhaka") return "BD";
  if (tz === "Europe/London") return "GB";
  if (tz.startsWith("Australia/")) return "AU";
  if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns|Montreal)$/.test(tz)) return "CA";
  if (/^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Indiana\/.+|Kentucky\/.+)|Pacific\/Honolulu)$/.test(tz))
    return "US";
  if (tz.startsWith("Europe/")) return "EU";
  return null;
}

/** Local emergency numbers for this device. Renders 112 first, then switches once the time zone is read. */
export function useEmergency(): Region {
  const [region, setRegion] = useState<Region>(DEFAULT);
  useEffect(() => {
    try {
      const code = regionFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
      if (code) setRegion(REGIONS[code]);
    } catch {}
  }, []);
  return region;
}

/** Display form: helpline numbers are stored as dialable digits. */
export function pretty(n: string): string {
  if (n === "08082000247") return "0808 2000 247";
  if (n === "18007997233") return "1-800-799-7233";
  if (n === "1800737732") return "1800 737 732";
  return n;
}
