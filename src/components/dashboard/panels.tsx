"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  GitCommitHorizontal,
  Info,
  Layers,
  Radar,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { SERVICES, SERVICE_MAP } from "@/lib/catalog/services";
import { STATUS_LABEL as HEALTH_LABEL, statusTone, type ServiceHealth } from "@/lib/analytics/health";
import type { FeedEvent, FeedKind, Incident, MetricPoint } from "@/lib/types";
import { cn, formatCompact, formatDuration, formatMs, formatPct, timeAgo } from "@/lib/utils";
import { Avatar, EmptyState, Panel, PanelHeader, SeverityBadge, Segmented, StatusBadge, TONE, buttonClass } from "@/components/ui/primitives";
import { CHART, Sparkline } from "@/components/charts/charts";

/* ───────────── Active incidents ───────────── */

export function ActiveIncidents({ incidents, now }: { incidents: Incident[]; now: number }) {
  const active = incidents
    .filter((i) => i.status !== "resolved")
    .sort((a, b) => a.severity.localeCompare(b.severity) || b.detectedAt - a.detectedAt);
  return (
    <Panel className="flex flex-col">
      <PanelHeader
        title="Active incidents"
        description={active.length ? `${active.length} open, sorted by severity` : "Nothing needs attention"}
        actions={
          <Link href="/incidents" className={buttonClass({ variant: "ghost", size: "xs" })}>
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        }
      />
      {active.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="All quiet" body="No active incidents. Sentinel is watching 13 services and will open one when it sees an anomaly." className="flex-1" />
      ) : (
        <ul className="flex-1 divide-y divide-hairline overflow-y-auto">
          <AnimatePresence initial={false}>
            {active.slice(0, 6).map((i) => (
              <motion.li key={i.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <Link href={`/incidents/${i.id}`} className="group block px-4 py-3 transition hover:bg-white/[0.025]">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={i.severity} pulse={i.severity === "SEV-1" || i.severity === "SEV-2"} />
                    <span className="font-mono text-[11px] text-ink-subtle">{i.id}</span>
                    <span className="tabular ml-auto text-[11.5px] text-ink-subtle">{formatDuration(now - i.impactStartedAt, { short: true })}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-1 text-[13px] font-medium text-ink group-hover:text-white">{i.title}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusBadge status={i.status} />
                    <span className="truncate font-mono text-[10.5px] text-ink-subtle">{i.affectedServices.slice(0, 3).join(" · ")}</span>
                    {i.commander && <Avatar name={i.commander} className="ml-auto h-5 w-5 text-[8.5px]" />}
                  </div>
                </Link>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}

/* ───────────── Service health grid ───────────── */

export function ServiceHealthGrid({ health, series }: { health: ServiceHealth[]; series: Record<string, MetricPoint[]> }) {
  const order = [...health].sort((a, b) => rank(b.status) - rank(a.status));
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Service health"
        description="p99 latency over the selected range. Sorted by status."
        actions={
          <Link href="/services" className={buttonClass({ variant: "ghost", size: "xs" })}>
            Service map <ArrowRight className="h-3 w-3" />
          </Link>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {order.map((h) => {
          const svc = SERVICE_MAP[h.id]!;
          const tone = statusTone(h.status);
          const pts = series[h.id] ?? [];
          return (
            <Link key={h.id} href={`/services?service=${h.id}`} className="group relative px-4 py-3 shadow-[1px_0_0_0_var(--color-hairline),0_1px_0_0_var(--color-hairline)] transition hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[12px] text-ink group-hover:text-white">{svc.id}</span>
                <span className={cn("flex shrink-0 items-center gap-1 text-[11px] font-medium", TONE[tone].text)}>
                  {h.status === "healthy" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {HEALTH_LABEL[h.status]}
                </span>
              </div>
              <div className="mt-1 flex gap-3 text-[11px] text-ink-subtle">
                <span className="tabular">
                  <span className="text-ink-muted">{formatCompact(h.metrics.rps)}</span> {svc.unit}
                </span>
                <span className="tabular">
                  err <span className={cn(h.metrics.errorRate >= 1 ? TONE.critical.text : "text-ink-muted")}>{formatPct(h.metrics.errorRate)}</span>
                </span>
                <span className="tabular">
                  p99 <span className={cn(h.metrics.p99 / svc.baseline.p99 > 1.9 ? TONE.warning.text : "text-ink-muted")}>{formatMs(h.metrics.p99)}</span>
                </span>
              </div>
              <Sparkline values={pts.map((p) => p.p99)} color={h.status === "healthy" ? CHART.signalDim : TONE[tone].hex} height={26} className="mt-2" />
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

const rank = (s: ServiceHealth["status"]) => (s === "critical" ? 2 : s === "degraded" ? 1 : 0);

/* ───────────── Live event feed ───────────── */

const FEED_ICON: Record<FeedKind, LucideIcon> = {
  deploy: Rocket,
  config: SlidersHorizontal,
  scale: Layers,
  alert: AlertTriangle,
  anomaly: Radar,
  incident: AlertTriangle,
  recovery: CheckCircle2,
  info: Info,
};

type FeedFilter = "all" | "incidents" | "changes" | "anomalies";

export function LiveFeed({ events, now, live }: { events: FeedEvent[]; now: number; live: boolean }) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const shown = useMemo(
    () =>
      events.filter((e) =>
        filter === "all" ? true : filter === "incidents" ? e.kind === "incident" || e.kind === "recovery" : filter === "changes" ? e.kind === "deploy" || e.kind === "config" : e.kind === "anomaly" || e.kind === "recovery"
      ),
    [events, filter]
  );
  return (
    <Panel className="flex h-full min-h-[420px] flex-col">
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            Live event feed
            {live && (
              <span className="flex items-center gap-1 text-[11px] font-normal text-signal">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inset-0 animate-pulse-ring rounded-full bg-signal" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-signal" />
                </span>
                streaming
              </span>
            )}
          </span>
        }
        description="Deploys, scaling, detections and incident activity"
      />
      <div className="border-b border-hairline px-3 py-2">
        <Segmented
          size="xs"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "incidents", label: "Incidents" },
            { value: "changes", label: "Changes" },
            { value: "anomalies", label: "Anomalies" },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={Activity} title="No events in this window" body="Try another filter, or simulate an incident to generate activity." className="flex-1" />
      ) : (
        <ul className="relative max-h-[560px] flex-1 overflow-y-auto">
          <AnimatePresence initial={false}>
            {shown.slice(0, 40).map((e) => {
              const Icon = FEED_ICON[e.kind];
              const row = (
                <div className="flex gap-3 px-4 py-2.5">
                  <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] ring-1 ring-inset", TONE[e.tone].bg, TONE[e.tone].ring)}>
                    <Icon className={cn("h-3.5 w-3.5", TONE[e.tone].text)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] leading-snug text-ink-muted">{e.message}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                      <span className="tabular">{timeAgo(e.t, now)}</span>
                      {e.service && <span className="font-mono">{e.service}</span>}
                    </p>
                  </div>
                </div>
              );
              return (
                <motion.li key={e.id} layout="position" initial={{ opacity: 0, x: -8, backgroundColor: "rgba(54,214,231,0.06)" }} animate={{ opacity: 1, x: 0, backgroundColor: "rgba(54,214,231,0)" }} transition={{ duration: 0.6 }} className="border-b border-hairline last:border-0">
                  {e.href ? (
                    <Link href={e.href} className="block transition hover:bg-white/[0.02]">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}

/* ───────────── Recent incident activity ───────────── */

export function RecentActivity({ incidents, now }: { incidents: Incident[]; now: number }) {
  const items = incidents
    .flatMap((i) => i.timeline.map((e) => ({ ...e, inc: i })))
    .filter((e) => e.at <= now)
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
  return (
    <Panel>
      <PanelHeader title="Recent incident activity" description="Latest updates from responders and Sentinel" />
      {items.length === 0 ? (
        <EmptyState icon={GitCommitHorizontal} title="No activity yet" />
      ) : (
        <ol className="px-4 py-2">
          {items.map((e, idx) => (
            <li key={e.id} className="relative flex gap-3 py-2">
              {idx < items.length - 1 && <span className="absolute left-3 top-9 h-[calc(100%-22px)] w-px bg-hairline-strong" aria-hidden />}
              <Avatar name={e.actor} tone={e.actor === "Sentinel" ? "signal" : undefined} />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] leading-snug text-ink-muted">
                  <span className="font-medium text-ink">{e.actor}</span> <span className="text-ink-subtle">on</span>{" "}
                  <Link href={`/incidents/${e.inc.id}`} className="font-mono text-[11.5px] text-intel-bright hover:underline">
                    {e.inc.id}
                  </Link>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-muted">{e.message}</p>
              </div>
              <span className="tabular shrink-0 pt-0.5 text-[11px] text-ink-faint">{timeAgo(e.at, now)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/* ───────────── Top affected services (7d) ───────────── */

export function TopAffected({ incidents, now, health }: { incidents: Incident[]; now: number; health: ServiceHealth[] }) {
  const rows = useMemo(() => {
    const from = now - 7 * 86_400_000;
    const acc = new Map<string, { minutes: number; count: number }>();
    for (const i of incidents) {
      const end = i.resolvedAt ?? now;
      if (end < from) continue;
      const mins = (end - Math.max(i.impactStartedAt, from)) / 60_000;
      for (const s of i.affectedServices) {
        const cur = acc.get(s) ?? { minutes: 0, count: 0 };
        cur.minutes += mins;
        cur.count += 1;
        acc.set(s, cur);
      }
    }
    return [...acc.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.minutes - a.minutes).slice(0, 7);
  }, [incidents, now]);
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  return (
    <Panel>
      <PanelHeader title="Top affected services" description="Incident minutes in the last 7 days" icon={Boxes} />
      {rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No incidents in the last 7 days" />
      ) : (
        <ul className="space-y-3 px-4 py-4">
          {rows.map((r) => {
            const h = health.find((x) => x.id === r.id);
            return (
              <li key={r.id}>
                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                  <Link href={`/services?service=${r.id}`} className="flex items-center gap-2 font-mono text-ink-muted hover:text-ink">
                    <span className={cn("h-1.5 w-1.5 rounded-full", h ? TONE[statusTone(h.status)].dot : "bg-ink-subtle")} />
                    {r.id}
                  </Link>
                  <span className="tabular text-ink-subtle">
                    <span className="text-ink-muted">{formatDuration(r.minutes * 60_000, { short: true })}</span> · {r.count} incident{r.count > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <motion.div className="h-full rounded-full bg-intel/75" initial={{ width: 0 }} animate={{ width: `${(r.minutes / max) * 100}%` }} transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export { SERVICES };
