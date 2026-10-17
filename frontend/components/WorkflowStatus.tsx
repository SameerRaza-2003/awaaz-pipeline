"use client";

import { Check, Clock, Loader2, Minus, TriangleAlert } from "lucide-react";
import { NodeStatus } from "@/lib/workflow";

export const STATE_LABEL: Record<NodeStatus, string> = {
  idle: "Idle",
  running: "Running",
  waiting: "Waiting",
  done: "Done",
  error: "Failed",
  skipped: "Skipped",
};

const TONE: Record<NodeStatus, string> = {
  idle: "text-muted",
  running: "text-info",
  waiting: "text-hold",
  done: "text-safe-ink",
  error: "text-danger-ink",
  skipped: "text-muted",
};

/** Status as icon + word, never colour alone. */
export function StatusMark({ status }: { status: NodeStatus }) {
  const cls = `shrink-0 ${TONE[status]}`;
  const icon =
    status === "running" ? (
      <Loader2 size={14} strokeWidth={2} className={`${cls} animate-spin`} aria-hidden />
    ) : status === "done" ? (
      <Check size={14} strokeWidth={2.25} className={cls} aria-hidden />
    ) : status === "error" ? (
      <TriangleAlert size={14} strokeWidth={2} className={cls} aria-hidden />
    ) : status === "waiting" ? (
      <Clock size={14} strokeWidth={2} className={cls} aria-hidden />
    ) : status === "skipped" ? (
      <Minus size={14} strokeWidth={2} className={cls} aria-hidden />
    ) : (
      <span className="h-2 w-2 shrink-0 rounded-full border border-line-strong" aria-hidden />
    );
  return (
    <span className={`inline-flex items-center gap-1.5 text-caption font-semibold ${TONE[status]}`}>
      {icon}
      {STATE_LABEL[status]}
    </span>
  );
}
