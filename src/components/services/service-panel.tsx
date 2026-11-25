"use client";

import Link from "next/link";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, GitBranch, ScrollText, Siren, X } from "lucide-react";
import { CALLERS, SERVICE_MAP } from "@/lib/catalog/services";
import { serviceHealth, statusTone, STATUS_LABEL as HEALTH_LABEL } from "@/lib/analytics/health";
import { generateLogs } from "@/lib/sim/logs";
import { buildTimes, sampleMetrics, serviceSeries } from "@/lib/sim/telemetry";
import type { ChangeEvent, Incident } from "@/lib/types";
import { cn, formatCompact, formatMs, formatPct, timeAgo } from "@/lib/utils";
import { Button, SeverityBadge, StatusBadge, TONE, buttonClass } from "@/components/ui/primitives";
import { CHART, Sparkline } from "@/components/charts/charts";
import { LogRow } from "@/components/logs/log-row";
import { KIND_ICON } from "./service-node";

export function ServicePanel({ id, now, incidents, changes, onSelect, onClose }: { id: string; now: number; incidents: Incident[]; changes: ChangeEvent[]; onSelect: (id: string) => void; onClose: () => void }) {
  const svc = SERVICE_MAP[id]!;
  const Icon = KIND_ICON[svc.kind];
  const data = useMemo(() => {
    const times = buildTimes(now, 60 * 60_000, 30_000);
    const series = serviceSeries(id, times, incidents);
    const health = serviceHealth(svc, sampleMetrics(svc, now, incidents));
    const logs = generateLogs({ from: now - 15 * 60_000, to: now, incidents, budget: 1500 }).filter((l) => l.service === id).slice(0, 12);
    return { series, health, logs };
  }, [id, now, incidents, svc]);
  const tone = statusTone(data.health.status);
  const related = incidents.filter((i) => i.affectedServices.includes(id)).sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || b.detectedAt - a.detectedAt).slice(0, 5);
  const svcChanges = changes.filter((c) => c.service === id && c.at <= now).slice(0, 4);
  const m = data.health.metrics;

  const metrics = [
    { label: "Throughput", value: `${formatCompact(m.rps)} ${svc.unit}`, values: data.series.map((p) => p.rps), base: `baseline ${formatCompact(svc.baseline.rps)}` },
    { label: "Error rate", value: formatPct(m.errorRate), values: data.series.map((p) => p.errorRate), base: `baseline ${formatPct(svc.baseline.errorRate)}`, hot: m.errorRate >= 1 },
    { label: "p99 latency", value: formatMs(m.p99), values: data.series.map((p) => p.p99), base: `SLO ${formatMs(svc.slo.latencyP99)}`, hot: m.p99 > svc.slo.latencyP99 },
    { label: "p50 latency", value: formatMs(m.p50), values: data.series.map((p) => p.p50), base: `baseline ${formatMs(svc.baseline.p50)}` },
    { label: "CPU", value: `${m.cpu.toFixed(0)}%`, values: data.series.map((p) => p.cpu), base: `${svc.replicas} replicas`, hot: m.cpu > 85 },
    { label: "Memory", value: `${m.mem.toFixed(0)}%`, values: data.series.map((p) => p.mem), base: svc.runtime, hot: m.mem > 90 },
  ];

  const DepRow = ({ dep, dir }: { dep: string; dir: "out" | "in" }) => {
    const d = SERVICE_MAP[dep]!;
    const h = serviceHealth(d, sampleMetrics(d, now, incidents));
    return (
      <button onClick={() => onSelect(dep)} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left transition hover:bg-white/[0.04]">
        {dir === "out" ? <ArrowUpRight className="h-3 w-3 text-ink-subtle" /> : <ArrowDownRight className="h-3 w-3 text-ink-subtle" />}
        <span className="font-mono text-[12px] text-ink">{dep}</span>
        <span className={cn("ml-auto flex items-center gap-1.5 text-[11px]", TONE[statusTone(h.status)].text)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", TONE[statusTone(h.status)].dot)} />
          {HEALTH_LABEL[h.status]}
        </span>
      </button>
    );
  };

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      className="glass absolute inset-y-3 right-3 z-20 flex w-[min(420px,calc(100%-24px))] flex-col overflow-hidden rounded-[12px]"
      aria-label={`${id} details`}
    >
      <header className="border-b border-hairline px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] ring-1", TONE[tone].bg, TONE[tone].ring)}>
            <Icon className={cn("h-4 w-4", TONE[tone].text)} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-mono text-[15px] font-semibold text-ink">{svc.id}</h2>
            <p className="text-[12px] text-ink-subtle">
              {svc.team} · {svc.runtime} · {svc.version}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">{svc.description}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px]">
          <span className={cn("inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 font-medium ring-1 ring-inset", TONE[tone].bg, TONE[tone].text, TONE[tone].ring)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", TONE[tone].dot)} />
            {HEALTH_LABEL[data.health.status]}
          </span>
          {data.health.reasons.length > 0 && <span className="text-ink-subtle">{data.health.reasons.join(", ")}</span>}
          <span className="ml-auto text-ink-subtle">
            {svc.region} · SLO {svc.slo.availability}%
          </span>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section>
          <h3 className="mb-2 text-[12px] font-medium text-ink-muted">Last hour</h3>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] bg-hairline ring-1 ring-hairline">
            {metrics.map((x) => (
              <div key={x.label} className="bg-[#0d121c] px-3 pb-2 pt-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-ink-subtle">{x.label}</span>
                  <span className={cn("tabular text-[12.5px] font-semibold", x.hot ? "text-[#ff8da0]" : "text-ink")}>{x.value}</span>
                </div>
                <Sparkline values={x.values} height={30} color={x.hot ? "#f43f5e" : CHART.signal} className="mt-1.5" />
                <p className="mt-1 truncate text-[10px] text-ink-faint">{x.base}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="mb-1 text-[12px] font-medium text-ink-muted">Calls ({svc.dependencies.length})</h3>
            {svc.dependencies.length ? svc.dependencies.map((d) => <DepRow key={d} dep={d} dir="out" />) : <p className="px-2 py-1.5 text-[12px] text-ink-subtle">No downstream dependencies</p>}
          </div>
          <div>
            <h3 className="mb-1 text-[12px] font-medium text-ink-muted">Called by ({CALLERS[id]?.length ?? 0})</h3>
            {CALLERS[id]?.length ? CALLERS[id]!.map((d) => <DepRow key={d} dep={d} dir="in" />) : <p className="px-2 py-1.5 text-[12px] text-ink-subtle">Entry point</p>}
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-muted">
            <Siren className="h-3.5 w-3.5" /> Incidents
          </h3>
          {related.length === 0 ? (
            <p className="text-[12px] text-ink-subtle">No incidents have involved this service.</p>
          ) : (
            <ul className="space-y-1">
              {related.map((i) => (
                <li key={i.id}>
                  <Link href={`/incidents/${i.id}`} className="flex items-center gap-2 rounded-[6px] px-2 py-1.5 transition hover:bg-white/[0.04]">
                    <SeverityBadge severity={i.severity} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{i.title}</span>
                    <StatusBadge status={i.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-muted">
            <GitBranch className="h-3.5 w-3.5" /> Recent changes
          </h3>
          {svcChanges.length === 0 ? (
            <p className="text-[12px] text-ink-subtle">No changes recorded.</p>
          ) : (
            <ul className="space-y-2">
              {svcChanges.map((c) => (
                <li key={c.id} className="text-[12px]">
                  <p className="text-ink-muted">
                    {c.version && <span className="mr-1.5 font-mono text-[11px] text-signal/80">{c.version}</span>}
                    {c.summary}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    {c.kind} by {c.author}, {timeAgo(c.at, now)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-ink-muted">
              <ScrollText className="h-3.5 w-3.5" /> Recent logs
            </h3>
            <Link href={`/logs?service=${id}`} className={buttonClass({ variant: "ghost", size: "xs" })}>
              Open in Log Explorer
            </Link>
          </div>
          <ul className="overflow-hidden rounded-[8px] ring-1 ring-hairline">
            {data.logs.length ? data.logs.map((l) => <LogRow key={l.id} log={l} compact />) : <li className="px-3 py-3 text-[12px] text-ink-subtle">No log lines in the last 15 minutes.</li>}
          </ul>
        </section>
      </div>
    </motion.aside>
  );
}
