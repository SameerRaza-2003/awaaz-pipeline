"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { StatusMark } from "@/components/WorkflowStatus";
import { AgentCard, displayName } from "@/lib/workflow";

function Json({ value }: { value: unknown }) {
  if (value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre tabIndex={0} className="scroll-thin mt-1 max-h-60 overflow-auto rounded-sm bg-paper p-2.5 font-mono text-caption leading-relaxed whitespace-pre-wrap break-words text-ink-2">
      {text}
    </pre>
  );
}

const offset = (start: string, ts: string) => {
  const ms = new Date(ts).getTime() - new Date(start).getTime();
  return `+${(Math.max(0, ms) / 1000).toFixed(1)}s`;
};

export function AgentConsole({ cards, focus }: { cards: AgentCard[]; focus?: string | null }) {
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const total = cards.reduce((a, c) => ({ cost: a.cost + c.cost_usd, tokens: a.tokens + c.tokens_in + c.tokens_out }), { cost: 0, tokens: 0 });

  useEffect(() => {
    if (!focus) return;
    const last = [...cards].reverse().find((c) => c.node === focus);
    if (last) refs.current[last.run_id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, cards]);

  return (
    <div className="flex h-full flex-col">
      <dl className="grid grid-cols-3 border-b border-line text-small">
        {[
          ["Agent runs", String(cards.length)],
          ["Tokens", total.tokens.toLocaleString("en-GB")],
          ["Cost", `$${total.cost.toFixed(4)}`],
        ].map(([k, v]) => (
          <div key={k} className="border-r border-line px-4 py-2.5 last:border-r-0">
            <dt className="label">{k}</dt>
            <dd className="tabular font-mono text-body">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" tabIndex={0} aria-label="Agent runs">
        {cards.length === 0 ? (
          <p className="p-5 text-small text-muted">Each agent appears here when it runs, with every tool call, its arguments and its result.</p>
        ) : (
          <ol className="divide-y divide-line">
            {cards.map((c) => (
              <li
                key={c.run_id}
                ref={(el) => {
                  refs.current[c.run_id] = el;
                }}
                className={`px-4 py-4 ${focus === c.node ? "bg-info-soft" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="font-sans text-body font-semibold">{displayName(c.agent)}</h3>
                  <StatusMark status={c.status === "running" ? "running" : c.status === "done" ? "done" : "error"} />
                  <span className="ml-auto font-mono text-caption text-muted">{c.model}</span>
                </div>
                <p className="mt-1 text-caption text-muted">
                  <span className="font-mono">{c.tools.join(" · ") || "no tools"}</span>
                  <span className="tabular"> · {(c.tokens_in + c.tokens_out).toLocaleString("en-GB")} tokens · ${c.cost_usd.toFixed(5)}</span>
                </p>

                {c.calls.length > 0 && (
                  <ol className="mt-3 border-l border-line-strong">
                    {c.calls.map((t, i) => (
                      <li key={i} className="relative pl-4">
                        <span
                          className={`absolute -left-1 top-3.5 h-2 w-2 rounded-full ${t.error ? "bg-danger" : t.result === undefined ? "bg-info" : "bg-ink-2"}`}
                          aria-hidden
                        />
                        <details open={i === c.calls.length - 1}>
                          <summary className="flex min-h-10 list-none items-center gap-2 text-small">
                            <ChevronRight size={14} strokeWidth={1.75} className="shrink-0 text-muted transition-transform [details[open]_&]:rotate-90" aria-hidden />
                            <span className={`font-mono ${t.redacted ? "italic text-muted" : "font-semibold"}`}>{t.tool}</span>
                            {t.error ? (
                              <span className="text-caption text-danger-ink">failed</span>
                            ) : t.result === undefined ? (
                              <span className="text-caption text-info">running</span>
                            ) : null}
                            <span className="tabular ml-auto font-mono text-caption text-muted">
                              {offset(c.started, t.ts)}
                              {t.duration_ms !== undefined ? ` · ${t.duration_ms} ms` : ""}
                            </span>
                          </summary>
                          <div className="space-y-2 pb-3 pl-6">
                            {t.args !== undefined && Object.keys(t.args || {}).length > 0 && (
                              <div>
                                <p className="label">Arguments</p>
                                <Json value={t.args} />
                              </div>
                            )}
                            {t.error ? (
                              <p className="font-mono text-caption text-danger-ink">{t.error}</p>
                            ) : (
                              t.result !== undefined && (
                                <div>
                                  <p className="label">Result</p>
                                  <Json value={t.result} />
                                </div>
                              )
                            )}
                          </div>
                        </details>
                      </li>
                    ))}
                  </ol>
                )}

                {c.messages.length > 0 && (
                  <div className="mt-3">
                    <p className="label">Model messages</p>
                    <ul className="mt-1 space-y-1">
                      {c.messages.map((m, i) => (
                        <li key={i} className="text-small text-ink-2" dir="auto">
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {c.output !== undefined && (
                  <details className="mt-3">
                    <summary className="label flex min-h-10 cursor-pointer list-none items-center">Output (raw JSON)</summary>
                    <Json value={c.output} />
                  </details>
                )}
                {c.error && <p className="mt-2 font-mono text-caption text-danger-ink">{c.error}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
