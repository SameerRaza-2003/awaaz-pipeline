"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, Health, store } from "@/lib/api";
import { useEvents } from "@/lib/useEvents";
import { fmtCountdown } from "@/lib/workflow";

type Row = {
  police_ref: string;
  public_ref: string;
  received_at: string;
  status: string;
  country: string;
  city: string | null;
  harassment_type: string | null;
  last_updated: string;
  escalation_due_at?: string;
  escalation_state?: string;
  escalation_cancelled?: boolean;
  escalated_to_news?: boolean;
};

type Detail = Row & {
  full_text: string;
  complainant_name: string | null;
  complainant_contact: string | null;
  complainant_address: string | null;
  accused: string | null;
  history: { status: string; changed_at: string; note: string | null }[];
};

const STATUS_STYLE: Record<string, string> = {
  NEW: "bg-warn-soft text-warn",
  ACKNOWLEDGED: "bg-run-soft text-run",
  IN_PROGRESS: "bg-run-soft text-run",
  RESOLVED: "bg-ok-soft text-ok",
  REJECTED: "bg-surface-2 text-ink-2",
};

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ token: string }>("/api/police/login", { body: { username: u, password: p } });
      onToken(r.token);
    } catch {
      setErr("Invalid username or password");
    }
  };
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3 p-6">
        <h1 className="text-xl font-semibold">Police dashboard</h1>
        <p className="text-sm text-muted">Authorised officers only. Demo credentials are set in the server .env.</p>
        <input className="field" placeholder="Username" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} />
        <input className="field" placeholder="Password" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <p className="text-sm text-danger">{err}</p>}
        <button className="btn btn-primary w-full">Sign in</button>
      </form>
    </div>
  );
}

export default function PolicePage() {
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    setToken(store.get("awaaz_police_token"));
    api<Health>("/healthz").then(setHealth).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const logout = useCallback(() => {
    store.del("awaaz_police_token");
    setToken(null);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api<{ complaints: Row[]; statuses: string[] }>("/api/police/complaints", { token });
      setRows(r.complaints);
      setStatuses(r.statuses);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) logout();
    }
  }, [token, logout]);

  const loadDetail = useCallback(async () => {
    if (!token || !sel) return;
    try {
      const d = await api<Detail>(`/api/police/complaints/${sel}`, { token });
      setDetail(d);
      setNewStatus((s) => s || d.status);
    } catch {}
  }, [token, sel]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setNewStatus("");
    setNote("");
    setMsg(null);
    loadDetail();
  }, [loadDetail]);

  const tokenStillValid = useCallback(async () => {
    if (!token) return false;
    try {
      await api("/api/police/complaints", { token });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        return false;
      }
      throw e;
    }
  }, [token, logout]);

  const { events } = useEvents(token ? `/api/police/events?token=${encodeURIComponent(token)}` : null, tokenStillValid);
  const lastId = events[events.length - 1]?.id;
  useEffect(() => {
    if (lastId) {
      load();
      loadDetail();
    }
  }, [lastId, load, loadDetail]);

  const activity = useMemo(
    () =>
      events
        .filter((e) => (e.kind === "status" || e.kind === "error" || e.kind === "step") && e.data.message)
        .slice(-6)
        .reverse(),
    [events],
  );

  const save = async () => {
    if (!token || !sel) return;
    try {
      await api(`/api/police/complaints/${sel}/status`, { method: "PATCH", token, body: { status: newStatus, note: note || undefined } });
      setMsg("Status saved.");
      setNote("");
      await Promise.all([load(), loadDetail()]);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save");
    }
  };

  const fastForward = async (publicRef: string) => {
    await api(`/api/demo/fast-forward/${publicRef}`, { body: {} }).catch((e) => setMsg(e.message));
  };

  if (!token)
    return (
      <Login
        onToken={(t) => {
          store.set("awaaz_police_token", t);
          setToken(t);
        }}
      />
    );

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 p-3 sm:p-4">
      <div className="card flex items-center gap-3 overflow-hidden px-4 py-2" aria-live="polite">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">Live activity</span>
        <div className="flex min-w-0 flex-1 gap-4 overflow-x-auto whitespace-nowrap text-sm">
          {activity.length === 0 && <span className="text-muted">Waiting for activity…</span>}
          {activity.map((e) => (
            <span key={e.id} className={e.kind === "error" ? "text-danger" : ""}>
              <span className="text-muted">{e.ts.slice(11, 19)}</span> {e.data.message}
            </span>
          ))}
        </div>
        <button className="btn btn-ghost !min-h-9 !py-1 text-sm" onClick={logout}>
          Sign out
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="p-3">Public ref</th>
                <th className="p-3">Received</th>
                <th className="p-3">Type</th>
                <th className="p-3">City</th>
                <th className="p-3">Status</th>
                <th className="p-3">Escalation</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-muted">
                    No complaints yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const cd = fmtCountdown(r.escalation_due_at, now);
                const pending = r.escalation_state === "pending" && !r.escalation_cancelled;
                return (
                  <tr
                    key={r.police_ref}
                    onClick={() => setSel(r.police_ref)}
                    className={`cursor-pointer border-b border-line hover:bg-surface-2 ${sel === r.police_ref ? "bg-surface-2" : ""}`}
                  >
                    <td className="p-3">
                      <div className="font-mono font-semibold">{r.public_ref}</div>
                      <div className="font-mono text-xs text-muted">{r.police_ref}</div>
                    </td>
                    <td className="p-3">{new Date(r.received_at).toLocaleString()}</td>
                    <td className="p-3">{r.harassment_type}</td>
                    <td className="p-3">{r.city}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status] || ""}`}>{r.status}</span>
                    </td>
                    <td className="p-3">
                      {r.escalated_to_news && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">escalated to news</span>}
                      {!r.escalated_to_news && pending && <span className={`font-mono text-xs ${cd.overdue ? "text-danger font-semibold" : ""}`}>{cd.text}</span>}
                      {!r.escalated_to_news && !pending && <span className="text-xs text-muted">{r.escalation_cancelled ? "cancelled" : r.escalation_state ?? "—"}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card p-4">
          {!detail && <p className="text-muted">Select a complaint to see the full account.</p>}
          {detail && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-mono text-lg font-semibold">{detail.police_ref}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[detail.status] || ""}`}>{detail.status}</span>
                <span className="text-xs text-muted">public ref {detail.public_ref}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">Complainant</dt>
                <dd>{detail.complainant_name || "—"}</dd>
                <dt className="text-muted">Contact</dt>
                <dd>{detail.complainant_contact || "—"}</dd>
                <dt className="text-muted">Address</dt>
                <dd>{detail.complainant_address || "—"}</dd>
                <dt className="text-muted">Accused</dt>
                <dd>{detail.accused || "—"}</dd>
                <dt className="text-muted">Location</dt>
                <dd>
                  {detail.city || "—"}, {detail.country}
                </dd>
              </dl>
              <div>
                <h3 className="text-sm font-semibold">Full account</h3>
                <p className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm" dir="auto">
                  {detail.full_text}
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Update status</h3>
                <p className="text-xs text-muted">IN_PROGRESS, RESOLVED or REJECTED before the deadline prevents news escalation. ACKNOWLEDGED alone does not.</p>
                <div className="flex flex-wrap gap-2">
                  <select className="field !w-auto" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <input className="field flex-1" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className="btn btn-primary" onClick={save}>
                    Save
                  </button>
                </div>
                {msg && <p className="text-sm">{msg}</p>}
                {health?.demo_routes && detail.escalation_state === "pending" && !detail.escalation_cancelled && (
                  <button className="btn btn-ghost text-sm" onClick={() => fastForward(detail.public_ref)}>
                    Demo: fast-forward to deadline
                  </button>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold">History</h3>
                <ol className="mt-1 space-y-1 text-sm">
                  {detail.history.map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted">{new Date(h.changed_at).toLocaleString()}</span>
                      <span className="font-semibold">{h.status}</span>
                      <span className="text-ink-2">{h.note}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
