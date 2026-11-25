"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { motion } from "framer-motion";
import type { Telemetry } from "@/lib/hooks";
import type { MetricPoint, Severity, Tone } from "@/lib/types";
import { scoreLabel, scoreTone } from "@/lib/analytics/health";
import { cn, formatCompact, formatMs, formatPct } from "@/lib/utils";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { PulseDot, SEV_TONE, TONE } from "@/components/ui/primitives";
import { CHART, Sparkline } from "@/components/charts/charts";

export const avgLatency = (p: MetricPoint) => p.p50 * 0.6 + p.p95 * 0.3 + p.p99 * 0.1;

function HealthRing({ score }: { score: number }) {
  const tone = scoreTone(score);
  const R = 46;
  const C = 2 * Math.PI * R;
  const color = TONE[tone].hex;
  return (
    <div className="relative h-[120px] w-[120px] shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(148,163,196,0.08)" strokeWidth="7" />
        {Array.from({ length: 40 }).map((_, i) => {
          const a = (i / 40) * Math.PI * 2;
          return <line key={i} x1={60 + Math.cos(a) * 56} y1={60 + Math.sin(a) * 56} x2={60 + Math.cos(a) * 58.5} y2={60 + Math.sin(a) * 58.5} stroke="rgba(148,163,196,0.14)" strokeWidth="1" />;
        })}
        <motion.circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - score / 100) }}
          transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatedNumber value={score} format={(v) => Math.round(v).toString()} className="tabular text-[34px] font-semibold leading-none tracking-[-0.04em] text-ink" />
        <span className="mt-1 text-[10.5px] text-ink-subtle">of 100</span>
      </div>
    </div>
  );
}

function Delta({ now, base, goodWhenUp, suffix = "vs yesterday" }: { now: number; base: number; goodWhenUp?: boolean; suffix?: string }) {
  if (!base) return <span className="text-[11.5px] text-ink-subtle">—</span>;
  const pct = ((now - base) / base) * 100;
  const flat = Math.abs(pct) < 3;
  const up = pct > 0;
  const tone: Tone = flat ? "neutral" : goodWhenUp === undefined ? "neutral" : up === goodWhenUp ? "good" : Math.abs(pct) > 60 ? "critical" : "warning";
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const big = Math.abs(pct) >= 1000;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11.5px]", TONE[tone].text)}>
      <Icon className="h-3 w-3" />
      <span className="tabular font-medium">{flat ? "Flat" : `${up ? "+" : "−"}${big ? `${(Math.abs(pct) / 100 + 1).toFixed(0)}×` : `${Math.abs(pct).toFixed(0)}%`}`}</span>
      <span className="text-ink-subtle">{suffix}</span>
    </span>
  );
}

function Kpi({ label, children, delta, spark, sparkColor, className }: { label: string; children: React.ReactNode; delta?: React.ReactNode; spark?: number[]; sparkColor?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-between gap-3 bg-panel px-4 py-4 sm:px-5", className)}>
      <div>
        <p className="text-[12px] text-ink-muted">{label}</p>
        <div className="mt-1.5 flex items-baseline gap-1.5">{children}</div>
        <div className="mt-1 min-h-[18px]">{delta}</div>
      </div>
      {spark && <Sparkline values={spark} color={sparkColor ?? CHART.signal} height={30} highlight />}
    </div>
  );
}

export function SignalStrip({ tel, compare, sevCounts }: { tel: Telemetry; compare: MetricPoint[]; sevCounts: Record<Severity, number> }) {
  const gw = tel.series["api-gateway"]!;
  const now = tel.snapshot["api-gateway"]!;
  const cmp = compare[compare.length - 1];
  const healthy = tel.health.filter((h) => h.status === "healthy").length;
  const degraded = tel.health.filter((h) => h.status !== "healthy");
  const tone = scoreTone(tel.score);
  const tail = gw.slice(-60);
  const errHot = now.errorRate > (cmp?.errorRate ?? now.errorRate) * 3 && now.errorRate > 0.5;
  const latHot = avgLatency(now) > (cmp ? avgLatency(cmp) : avgLatency(now)) * 1.6;
  const activeTotal = tel.active.length;

  const sentence = (() => {
    if (!activeTotal && !degraded.length) return "All 13 services are operating normally.";
    const parts: string[] = [];
    if (activeTotal) parts.push(`${activeTotal} active incident${activeTotal > 1 ? "s" : ""}`);
    if (degraded.length) parts.push(`${degraded.length} service${degraded.length > 1 ? "s" : ""} outside normal range`);
    return `${parts.join(" and ")}.`;
  })();

  return (
    <section className="panel overflow-hidden" aria-label="Platform signal">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,1.2fr)_minmax(0,5fr)]">
        <div className="relative flex items-center gap-5 border-b border-hairline px-5 py-5 lg:border-b-0 lg:border-r">
          <div className="pointer-events-none absolute -left-10 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full blur-3xl" style={{ background: `${TONE[tone].hex}14` }} />
          <HealthRing score={tel.score} />
          <div className="relative min-w-0">
            <p className="text-[12px] text-ink-muted">System health</p>
            <p className={cn("mt-1 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em]", TONE[tone].text)}>
              <PulseDot tone={tone} pulse={tone !== "good"} />
              {scoreLabel(tel.score)}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-snug text-ink-muted">{sentence}</p>
            {degraded.length > 0 && (
              <p className="mt-2 line-clamp-2 font-mono text-[11px] leading-relaxed text-ink-subtle">
                {degraded
                  .slice(0, 4)
                  .map((d) => d.id)
                  .join("  ")}
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-hairline sm:grid-cols-3 lg:grid-cols-5">
          <Kpi
            label="Requests per second"
            spark={tail.map((p) => p.rps)}
            delta={cmp && <Delta now={now.rps} base={cmp.rps} />}
          >
            <AnimatedNumber value={now.rps} format={(v) => formatCompact(v)} className="tabular text-[26px] font-semibold tracking-[-0.03em]" />
            <span className="text-[12px] text-ink-subtle">req/s</span>
          </Kpi>
          <Kpi
            label="Error rate"
            spark={tail.map((p) => p.errorRate)}
            sparkColor={errHot ? "#f43f5e" : CHART.signal}
            delta={cmp && <Delta now={now.errorRate} base={cmp.errorRate} goodWhenUp={false} />}
          >
            <AnimatedNumber value={now.errorRate} format={(v) => formatPct(v)} className={cn("tabular text-[26px] font-semibold tracking-[-0.03em]", errHot && "text-[#ff8da0]")} />
          </Kpi>
          <Kpi
            label="Avg latency"
            spark={tail.map(avgLatency)}
            sparkColor={latHot ? "#fbbf24" : CHART.signal}
            delta={cmp && <Delta now={avgLatency(now)} base={avgLatency(cmp)} goodWhenUp={false} />}
          >
            <AnimatedNumber value={avgLatency(now)} format={(v) => formatMs(v)} className="tabular text-[26px] font-semibold tracking-[-0.03em]" />
            <span className="text-[12px] text-ink-subtle">p99 {formatMs(now.p99)}</span>
          </Kpi>
          <Kpi label="Active incidents" delta={<span className="text-[11.5px] text-ink-subtle">{activeTotal ? "Across all severities" : "No open incidents"}</span>}>
            <span className="tabular text-[26px] font-semibold tracking-[-0.03em]">{activeTotal}</span>
            <span className="ml-1 flex flex-wrap gap-1">
              {(["SEV-1", "SEV-2", "SEV-3", "SEV-4"] as Severity[]).map((s) =>
                sevCounts[s] ? (
                  <span key={s} className={cn("rounded-[4px] px-1 font-mono text-[10px] font-semibold ring-1 ring-inset", TONE[SEV_TONE[s]].text, TONE[SEV_TONE[s]].bg, TONE[SEV_TONE[s]].ring)}>
                    {sevCounts[s]}×{s.replace("SEV-", "S")}
                  </span>
                ) : null
              )}
            </span>
          </Kpi>
          <Kpi
            className="col-span-2 lg:col-span-1"
            label="Services operational"
            delta={<span className="text-[11.5px] text-ink-subtle">{13 - healthy ? `${13 - healthy} need attention` : "Every service in range"}</span>}
          >
            <span className="tabular text-[26px] font-semibold tracking-[-0.03em]">{healthy}</span>
            <span className="text-[13px] text-ink-subtle">/ 13</span>
          </Kpi>
        </div>
      </div>
    </section>
  );
}
