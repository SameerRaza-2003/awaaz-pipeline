"use client";

import { useEffect, useRef } from "react";
import { AgentCard } from "@/lib/workflow";

function Json({ value }: { value: unknown }) {
  if (value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

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
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-3 py-2 text-sm">
        <span>
          <strong>{cards.length}</strong> agent runs
        </span>
        <span>
          tokens <strong>{total.tin.toLocaleString()}</strong> in / <strong>{total.tout.toLocaleString()}</strong> out
        </span>
        <span>
          cost <strong>${total.cost.toFixed(5)}</strong>
        </span>
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-3">
        {cards.length === 0 && <p className="text-muted text-sm">Agents will appear here as they run.</p>}
        {cards.map((c) => (
          <div
            key={c.run_id}
            ref={(el) => {
              refs.current[c.run_id] = el;
            }}
            className={`card p-3 ${focus === c.node ? "ring-2 ring-run" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{c.agent.replaceAll("_", " ")}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  c.status === "running" ? "bg-run-soft text-run" : c.status === "done" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"
                }`}
              >
                {c.status}
              </span>
              <span className="ml-auto font-mono text-[11px] text-muted">{c.model}</span>
            </div>
            <div className="mt-1 text-[12px] text-muted">
              tools: {c.tools.join(", ") || "—"} · {c.tokens_in + c.tokens_out} tokens · ${c.cost_usd.toFixed(5)}
            </div>
            {c.calls.length > 0 && (
              <ol className="mt-2 space-y-2">
                {c.calls.map((t, i) => (
                  <li key={i} className="rounded-lg border border-line p-2">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-mono font-semibold">{t.tool}()</span>
                      {t.duration_ms !== undefined && <span className="text-[11px] text-muted">{t.duration_ms} ms</span>}
                      {t.result === undefined && !t.error && <span className="text-[11px] text-run">running…</span>}
                    </div>
                    {t.args !== undefined && Object.keys(t.args || {}).length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-[11px] text-muted">arguments</summary>
                        <Json value={t.args} />
                      </details>
                    )}
                    {t.error ? (
                      <div className="mt-1 text-[12px] text-danger">{t.error}</div>
                    ) : (
                      t.result !== undefined && (
                        <details open>
                          <summary className="cursor-pointer text-[11px] text-muted">result</summary>
                          <Json value={t.result} />
                        </details>
                      )
                    )}
                  </li>
                ))}
              </ol>
            )}
            {c.messages.length > 0 && (
              <div className="mt-2 space-y-1">
                {c.messages.map((m, i) => (
                  <p key={i} className="text-[12px] text-ink-2" dir="auto">
                    💬 {m}
                  </p>
                ))}
              </div>
            )}
            {c.output !== undefined && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[12px] font-semibold">output</summary>
                <Json value={c.output} />
              </details>
            )}
            {c.error && <p className="mt-2 text-[12px] text-danger">{c.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
