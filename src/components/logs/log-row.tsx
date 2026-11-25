"use client";

import Link from "next/link";
import { memo, useState } from "react";
import { ChevronRight, Copy, Filter, Siren } from "lucide-react";
import { toast } from "sonner";
import type { LogEntry, LogLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVEL_STYLE: Record<LogLevel, string> = {
  DEBUG: "text-ink-faint",
  INFO: "text-[#7c8aa8]",
  WARN: "text-warning",
  ERROR: "text-[#ff7389]",
  FATAL: "text-white bg-critical/80 px-1 rounded-[3px]",
};

function highlight(text: string, needle: string) {
  if (!needle) return text;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-[2px] bg-intel/30 px-px text-white">{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

const fmt = (t: number) => {
  const d = new Date(t);
  return `${d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

export const LogRow = memo(function LogRow({ log, needle = "", onTrace, compact }: { log: LogEntry; needle?: string; onTrace?: (traceId: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const isErr = log.level === "ERROR" || log.level === "FATAL";
  const json = {
    timestamp: new Date(log.t).toISOString(),
    level: log.level,
    service: log.service,
    message: log.message,
    trace_id: log.traceId,
    span_id: log.spanId,
    host: log.host,
    ...log.attrs,
  };
  return (
    <li className={cn("border-b border-hairline font-mono text-[12px] last:border-0", isErr && "bg-critical/[0.045]", open && "bg-white/[0.025]")}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 px-3 py-1.5 text-left transition hover:bg-white/[0.03]">
        <ChevronRight className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform", open && "rotate-90 text-ink-muted")} />
        <span className="tabular w-[92px] shrink-0 text-ink-subtle">{fmt(log.t)}</span>
        <span className={cn("w-[42px] shrink-0 text-[11px] font-semibold", LEVEL_STYLE[log.level])}>{log.level}</span>
        {!compact && <span className="hidden w-[150px] shrink-0 truncate text-signal/80 md:block">{log.service}</span>}
        <span className={cn("min-w-0 flex-1 break-words", isErr ? "text-[#ffc2cc]" : log.level === "WARN" ? "text-[#f6e3b4]" : "text-ink-muted")}>
          {compact && <span className="mr-2 text-signal/80">{log.service}</span>}
          {highlight(log.message, needle)}
        </span>
        <span className="hidden shrink-0 text-[11px] text-ink-faint xl:block">{log.traceId.slice(0, 8)}</span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3 pl-[42px]">
          <div className="flex flex-wrap gap-2">
            {onTrace && (
              <button onClick={() => onTrace(log.traceId)} className="inline-flex h-6 items-center gap-1.5 rounded-[5px] bg-signal/10 px-2 font-sans text-[11.5px] text-signal ring-1 ring-signal/25 transition hover:bg-signal/15">
                <Filter className="h-3 w-3" /> Show trace {log.traceId.slice(0, 8)}
              </button>
            )}
            <button
              onClick={() => {
                navigator.clipboard?.writeText(JSON.stringify(json, null, 2)).catch(() => {});
                toast.success("Log entry copied as JSON");
              }}
              className="inline-flex h-6 items-center gap-1.5 rounded-[5px] bg-white/[0.04] px-2 font-sans text-[11.5px] text-ink-muted ring-1 ring-hairline-strong transition hover:text-ink"
            >
              <Copy className="h-3 w-3" /> Copy JSON
            </button>
            {log.incidentId && (
              <Link href={`/incidents/${log.incidentId}`} className="inline-flex h-6 items-center gap-1.5 rounded-[5px] bg-intel/10 px-2 font-sans text-[11.5px] text-intel-bright ring-1 ring-intel/30 transition hover:bg-intel/15">
                <Siren className="h-3 w-3" /> Correlated with {log.incidentId}
              </Link>
            )}
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-[7px] bg-midnight/70 p-3 ring-1 ring-hairline sm:grid-cols-2">
            {Object.entries(json).map(([k, v]) => (
              <div key={k} className="flex min-w-0 gap-3">
                <dt className="w-28 shrink-0 text-ink-subtle">{k}</dt>
                <dd className={cn("min-w-0 break-all", k === "trace_id" ? "text-signal" : "text-ink-muted")}>{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </li>
  );
});
