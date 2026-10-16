"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { AgentCard } from "@/lib/workflow";

function Json({ value }: { value: unknown }) {
  if (value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="scroll-thin mt-1 max-h-56 overflow-auto rounded-md bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-ink-2">
      {text}
    </pre>
  );
}

const STATUS: Record<string, string> = {
  running: "bg-run-soft text-run",
  done: "bg-ok-soft text-ok",
  error: "bg-danger-soft text-danger",
};

const pretty = (s: string) => s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

export function AgentConsole({ cards, focus }: { cards: AgentCard[]; focus?: string | null }) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const total = cards.reduce(
    (a, c) => ({ cost: a.cost + c.cost_usd, tin: a.tin + c.tokens_in, tout: a.tout + c.tokens_out }),
    { cost: 0, tin: 0, tout: 0 },
  );

  useEffect(() => {
    if (!focus) return;
    const last = [...cards].reverse().find((c) => c.node === focus);
    if (last) refs.current[last.run_id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, cards]);

  return (
    <div className="flex h-full flex-col">
      <dl className="grid grid-cols-3 border-b border-line text-sm">
        {[
          ["Agent runs", String(cards.length)],
          ["Tokens", `${(total.tin + total.tout).toLocaleString()}`],
          ["Cost", `$${total.cost.toFixed(4)}`],
        ].map(([k, v]) => (
          <div key={k} className="border-r border-line px-4 py-2.5 last:border-r-0">
            <dt className="label">{k}</dt>
            <dd className="font-mono text-[15px]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {cards.length === 0 && <p className="p-2 text-sm text-muted">Each agent appears here when it runs, with every tool call, its arguments and results.</p>}
        {cards.map((c) => (
          <div
            key={c.run_id}
            ref={(el) => {
              refs.current[c.run_id] = el;
            }}
            className={`card overflow-hidden ${focus === c.node ? "ring-2 ring-run/60" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="text-sm font-semibold">{pretty(c.agent)}</span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS[c.status]}`}>{c.status}</span>
              <span className="ml-auto font-mono text-[11px] text-muted">{c.model}</span>
            </div>
            <div className="px-4 py-2 text-[11px] text-muted">
              Tools: <span className="font-mono">{c.tools.join(", ") || "none"}</span>
              {" · "}
              {(c.tokens_in + c.tokens_out).toLocaleString()} tokens · ${c.cost_usd.toFixed(5)}
            </div>
            {c.calls.length > 0 && (
              <ol className="space-y-1.5 px-4 pb-3">
                {c.calls.map((t, i) => (
                  <li key={i} className="rounded-lg border border-line">
                    <details open={i === c.calls.length - 1}>
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px]">
                        <ChevronRight size={13} className="shrink-0 text-muted transition-transform [details[open]_&]:rotate-90" />
                        <span className="font-mono font-medium">{t.tool}</span>
                        {t.error ? (
                          <span className="text-[11px] text-danger">error</span>
                        ) : t.result === undefined ? (
                          <span className="text-[11px] text-run">running</span>
                        ) : null}
                        {t.duration_ms !== undefined && <span className="ml-auto font-mono text-[11px] text-muted">{t.duration_ms} ms</span>}
                      </summary>
                      <div className="space-y-2 border-t border-line px-3 py-2">
                        {t.args !== undefined && Object.keys(t.args || {}).length > 0 && (
                          <div>
                            <div className="label">Arguments</div>
                            <Json value={t.args} />
                          </div>
                        )}
                        {t.error ? (
                          <p className="text-[12px] text-danger">{t.error}</p>
                        ) : (
                          t.result !== undefined && (
                            <div>
                              <div className="label">Result</div>
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
              <div className="space-y-1 border-t border-line px-4 py-2.5">
                <div className="label">Model messages</div>
                {c.messages.map((m, i) => (
                  <p key={i} className="text-[12px] text-ink-2" dir="auto">
                    {m}
                  </p>
                ))}
              </div>
            )}
            {c.output !== undefined && (
              <details className="border-t border-line px-4 py-2.5">
                <summary className="label cursor-pointer">Output</summary>
                <Json value={c.output} />
              </details>
            )}
            {c.error && <p className="border-t border-line px-4 py-2.5 text-[12px] text-danger">{c.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
