"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, LogOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  NEW: "bg-hold-soft text-hold",
  ACKNOWLEDGED: "bg-info-soft text-info",
  IN_PROGRESS: "bg-info-soft text-info",
  RESOLVED: "bg-safe-soft text-safe-ink",
  REJECTED: "bg-sunken text-ink-2",
};
const ADDRESSED = new Set(["IN_PROGRESS", "RESOLVED", "REJECTED"]);
const human = (s: string | null) => (s ? s.replaceAll("_", " ").replace("/", " / ").replace(/^\w/, (c) => c.toUpperCase()) : "Not given");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Urgency = { key: string; label: string; tone: string; sort: number };
function urgency(r: Row, now: number): Urgency {
  if (r.escalated_to_news) return { key: "escalated", label: "Sent to news", tone: "text-danger-ink font-semibold", sort: 0 };
  if (ADDRESSED.has(r.status)) return { key: "addressed", label: "Addressed", tone: "text-safe-ink", sort: 5 };
  if (r.escalation_cancelled) return { key: "cancelled", label: "Escalation cancelled", tone: "text-muted", sort: 6 };
  if (r.escalation_state !== "pending" || !r.escalation_due_at) return { key: "none", label: "No deadline", tone: "text-muted", sort: 7 };
  const ms = new Date(r.escalation_due_at).getTime() - now;
  const cd = fmtCountdown(r.escalation_due_at, now);
  if (ms <= 0) return { key: "overdue", label: cd.text, tone: "text-danger-ink font-semibold", sort: 1 };
  if (ms < 6 * 3_600_000) return { key: "soon", label: `${cd.text} left`, tone: "text-hold font-semibold", sort: 2 };
  return { key: "ok", label: `${cd.text} left`, tone: "text-ink-2", sort: 3 };
}

function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${STATUS_STYLE[status] || "bg-sunken text-ink-2"}`}>{human(status)}</span>;
}

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
      setErr("Wrong username or password.");
    }
  };
  return (
    <div className="flex flex-1 items-center justify-center px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-md border border-line bg-surface p-6">
        <div>
          <h1 className="text-title font-semibold">Complaint queue</h1>
          <p className="mt-1 text-small text-ink-2">For authorised officers. Demo credentials are set on the server.</p>
        </div>
        <div>
          <label htmlFor="pu" className="text-small font-semibold">
            Username
          </label>
          <input id="pu" className="field mt-1 !min-h-11" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pp" className="text-small font-semibold">
            Password
          </label>
          <input id="pp" className="field mt-1 !min-h-11" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} />
        </div>
        {err && (
          <p className="text-small text-danger-ink" role="alert">
            {err}
          </p>
        )}
        <button className="btn btn-primary btn-compact w-full !min-h-11">Sign in</button>
      </form>
    </div>
  );
}

type SortKey = "received" | "status" | "deadline" | "type" | "city";
const FILTERS = [
  ["all", "All"],
  ["open", "Needs action"],
  ["soon", "Due within 6 h"],
  ["overdue", "Overdue"],
  ["escalated", "Sent to news"],
] as const;

export default function PolicePage() {
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [health, setHealth] = useState<Health | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "deadline", dir: 1 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const detailRef = useRef<HTMLElement>(null);

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
      setLoaded(true);
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

  const { events, connected } = useEvents(token ? `/api/police/events?token=${encodeURIComponent(token)}` : null, tokenStillValid);
  const lastId = events[events.length - 1]?.id;
  useEffect(() => {
    if (lastId) {
      load();
      loadDetail();
    }
  }, [lastId, load, loadDetail]);

  const activity = useMemo(
    () => events.filter((e) => (e.kind === "status" || e.kind === "error" || e.kind === "step") && e.data.message).slice(-5).reverse(),
    [events],
  );

  const view = useMemo(() => {
    const withU = rows.map((r) => ({ r, u: urgency(r, now) }));
    const filtered = withU.filter(({ u }) =>
      filter === "all" ? true : filter === "open" ? ["ok", "soon", "overdue"].includes(u.key) : u.key === filter,
    );
    const val = ({ r, u }: { r: Row; u: Urgency }): number | string => {
      switch (sort.key) {
        case "received":
          return new Date(r.received_at).getTime();
        case "status":
          return r.status;
        case "type":
          return r.harassment_type || "";
        case "city":
          return r.city || "";
        default:
          return u.sort * 1e13 + (r.escalation_due_at ? new Date(r.escalation_due_at).getTime() : 0);
      }
    };
    return filtered.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [rows, now, filter, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, open: 0, soon: 0, overdue: 0, escalated: 0 };
    for (const r of rows) {
      const u = urgency(r, now).key;
      if (["ok", "soon", "overdue"].includes(u)) c.open += 1;
      if (u in c) c[u] += 1;
    }
    return c;
  }, [rows, now]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !sel) return;
    try {
      await api(`/api/police/complaints/${sel}/status`, { method: "PATCH", token, body: { status: newStatus, note: note || undefined } });
      setMsg({ ok: true, text: "Status saved." });
      setNote("");
      await Promise.all([load(), loadDetail()]);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    }
  };

  const fastForward = async (publicRef: string) => {
    await api(`/api/demo/fast-forward/${publicRef}`, { body: {} }).catch((e) => setMsg({ ok: false, text: e.message }));
  };

  const select = (ref: string) => {
    setSel(ref);
    detailRef.current?.scrollTo({ top: 0 });
    setTimeout(() => detailRef.current?.focus({ preventScroll: true }), 50);
  };

  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "received" ? -1 : 1 }));
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none");
  const SortIcon = ({ k }: { k: SortKey }) =>
    sort.key !== k ? (
      <ArrowUpDown size={13} strokeWidth={1.75} className="text-muted" aria-hidden />
    ) : sort.dir === 1 ? (
      <ArrowUp size={13} strokeWidth={2} aria-hidden />
    ) : (
      <ArrowDown size={13} strokeWidth={2} aria-hidden />
    );

  if (!token)
    return (
      <Login
        onToken={(t) => {
          store.set("awaaz_police_token", t);
          setToken(t);
        }}
      />
    );

  const th = (key: SortKey, label: string, cls = "") => (
    <th scope="col" aria-sort={ariaSort(key)} className={`px-3 py-2 ${cls}`}>
      <button onClick={() => sortBy(key)} className="label inline-flex min-h-8 items-center gap-1 !text-ink-2 hover:!text-ink">
        {label}
        <SortIcon k={key} />
      </button>
    </th>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col text-small">
      <h1 className="sr-only">Complaint queue</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2 lg:px-6">
        <div role="group" aria-label="Filter complaints" className="flex flex-wrap gap-1">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={`min-h-9 rounded-sm px-2.5 text-caption font-semibold ${filter === k ? "bg-ink text-paper" : "text-ink-2 hover:bg-sunken"}`}
            >
              {label} <span className="tabular font-mono">{counts[k]}</span>
            </button>
          ))}
        </div>
        <p className="min-w-0 flex-1 truncate text-caption text-ink-2" role="log" aria-live="polite" aria-label="Live activity">
          <span className={`mr-2 inline-block h-2 w-2 rounded-full ${connected ? "bg-safe" : "bg-line-strong"}`} aria-hidden />
          {activity[0] ? (
            <>
              <span className="tabular font-mono text-muted">{activity[0].ts.slice(11, 19)}</span> {activity[0].data.message}
            </>
          ) : (
            "Live. Waiting for activity."
          )}
        </p>
        <button className="btn btn-secondary btn-compact" onClick={logout}>
          <LogOut size={16} strokeWidth={1.75} aria-hidden /> Sign out
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <section className="scroll-thin min-h-0 overflow-auto lg:border-r lg:border-line" aria-label="Complaints" tabIndex={0}>
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Complaints, sortable. Select a row to open the case file.</caption>
            <thead className="sticky top-0 z-(--z-sticky) border-b border-line-strong bg-paper">
              <tr>
                <th scope="col" className="label px-3 py-2 !text-ink-2">
                  Reference
                </th>
                {th("received", "Received")}
                {th("type", "Type", "hidden md:table-cell")}
                {th("city", "City", "hidden md:table-cell")}
                {th("status", "Status")}
                {th("deadline", "24 h deadline")}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!loaded ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-muted">
                    Loading complaints…
                  </td>
                </tr>
              ) : view.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-muted">
                    {rows.length === 0 ? "No complaints yet. New ones appear here as soon as they are submitted." : "No complaints match this filter."}
                  </td>
                </tr>
              ) : (
                view.map(({ r, u }) => (
                  <tr
                    key={r.police_ref}
                    tabIndex={0}
                    aria-selected={sel === r.police_ref}
                    onClick={() => select(r.police_ref)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        select(r.police_ref);
                      }
                      if (e.key === "ArrowDown") (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                      if (e.key === "ArrowUp") (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                    }}
                    className={`cursor-pointer align-top hover:bg-sunken ${sel === r.police_ref ? "bg-info-soft" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <span className="block whitespace-nowrap font-mono font-semibold">{r.public_ref}</span>
                      <span className="block font-mono text-caption text-muted">{r.police_ref}</span>
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2.5">{when(r.received_at)}</td>
                    <td className="hidden px-3 py-2.5 md:table-cell">{human(r.harassment_type)}</td>
                    <td className="hidden px-3 py-2.5 md:table-cell">{r.city || "Not given"}</td>
                    <td className="px-3 py-2.5">
                      <StatusChip status={r.status} />
                    </td>
                    <td className={`tabular whitespace-nowrap px-3 py-2.5 font-mono ${u.tone}`}>{u.label}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section
          ref={detailRef}
          tabIndex={-1}
          className="scroll-thin min-h-0 overflow-y-auto border-t border-line bg-surface outline-none lg:border-t-0"
          aria-label="Case file"
        >
          {!detail ? (
            <div className="px-6 py-10 text-ink-2">
              <h2 className="text-lead font-semibold text-ink">Case file</h2>
              <p className="mt-1">Select a complaint to read the full account and update its status. Use the arrow keys and Enter in the table.</p>
            </div>
          ) : (
            <article className="space-y-6 px-6 py-6">
              <header>
                <p className="label">Case file</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h2 className="font-mono text-title font-semibold">{detail.police_ref}</h2>
                  <StatusChip status={detail.status} />
                </div>
                <p className="mt-1 text-caption text-muted">
                  Public reference <span className="font-mono">{detail.public_ref}</span> · received {when(detail.received_at)}
                </p>
                <p className={`tabular mt-2 font-mono ${urgency(detail, now).tone}`}>{urgency(detail, now).label}</p>
              </header>

              <dl className="grid grid-cols-[8.5rem_1fr] gap-x-4 gap-y-2 border-y border-line py-4">
                {[
                  ["Complainant", detail.complainant_name],
                  ["Contact", detail.complainant_contact],
                  ["Address", detail.complainant_address],
                  ["Accused", detail.accused],
                  ["Type", human(detail.harassment_type)],
                  ["Location", `${detail.city || "Not given"}, ${detail.country}`],
                ].map(([k, v]) => (
                  <div key={k as string} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="[overflow-wrap:anywhere]">{v || "Not given"}</dd>
                  </div>
                ))}
              </dl>

              <section aria-labelledby="account-h">
                <h3 id="account-h" className="label">
                  Full account
                </h3>
                <p className="mt-2 max-w-prose whitespace-pre-wrap text-body leading-relaxed" dir="auto">
                  {detail.full_text}
                </p>
              </section>

              <form onSubmit={save} className="space-y-3 border-t border-line pt-5" aria-labelledby="status-h">
                <h3 id="status-h" className="label">
                  Update status
                </h3>
                <p className="text-caption text-muted">In progress, Resolved or Rejected before the deadline stops the news escalation. Acknowledged alone does not.</p>
                <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                  <div>
                    <label htmlFor="new-status" className="sr-only">
                      New status
                    </label>
                    <select id="new-status" className="field !min-h-11 text-small" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {human(s)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="status-note" className="sr-only">
                      Note
                    </label>
                    <input id="status-note" className="field !min-h-11 text-small" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn btn-primary btn-compact">Save status</button>
                  {health?.demo_routes && detail.escalation_state === "pending" && !detail.escalation_cancelled && (
                    <button type="button" className="btn btn-quiet btn-compact" onClick={() => fastForward(detail.public_ref)}>
                      Demo: skip to the deadline
                    </button>
                  )}
                  {msg && (
                    <span className={`text-small font-semibold ${msg.ok ? "text-safe-ink" : "text-danger-ink"}`} role="status">
                      {msg.text}
                    </span>
                  )}
                </div>
              </form>

              <section aria-labelledby="history-h" className="border-t border-line pt-5">
                <h3 id="history-h" className="label">
                  History
                </h3>
                <ol className="mt-2 space-y-2">
                  {detail.history.map((h, i) => (
                    <li key={i} className="grid grid-cols-[7.5rem_auto_1fr] items-baseline gap-3">
                      <span className="tabular font-mono text-caption text-muted">{when(h.changed_at)}</span>
                      <StatusChip status={h.status} />
                      <span className="text-ink-2">{h.note}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </article>
          )}
        </section>
      </div>
    </div>
  );
}
