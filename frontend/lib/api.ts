// Empty = same origin: Next.js forwards /api to the backend (works from phones on the LAN too).
export const API = process.env.NEXT_PUBLIC_API_URL || "";

export type AwaazEvent = {
  id: number;
  session_id: string;
  ts: string;
  kind: string;
  agent: string | null;
  node: string | null;
  run_id: string | null;
  data: Record<string, any>;
};

export type Health = {
  ok: boolean;
  outbound_mode: "dry_run" | "sandbox" | "live";
  alert_authorities: boolean;
  llm_configured: boolean;
  model_default: string;
  model_drafting: string;
  demo_routes: boolean;
  escalation_delay_seconds: number;
  match_threshold: number;
};

export type Drafts = {
  police_text: string;
  public_text: string;
  public_clean: boolean;
  pii_findings: { type: string }[];
};

export type SessionInfo = {
  session_id: string;
  phase: string;
  country: string;
  locale: string;
  trusted_contact: { name: string; phone: string | null; has_discord?: boolean; is_default?: boolean } | null;
  transcript: { role: "user" | "assistant"; text: string }[];
  drafts: Drafts | null;
  receipt: Receipt | null;
};

export type Receipt = {
  public_ref: string;
  public_clean: boolean;
  police_submitted?: boolean;
  submitted_at?: string;
  escalation_due_at?: string | null;
  communities?: { name: string; score: number; reason: string; status: string }[];
  authority?: { name: string; status: string } | null;
  no_match?: boolean;
  public_on_hold?: boolean;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(`${API}${path}`, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export const store = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {}
  },
  del(key: string) {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  },
};

export function quickExit() {
  try {
    sessionStorage.clear();
  } catch {}
  window.location.replace("https://www.google.com/search?q=weather");
}
