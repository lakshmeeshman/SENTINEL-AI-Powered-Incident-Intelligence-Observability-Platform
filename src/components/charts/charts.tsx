"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn, formatClock } from "@/lib/utils";

/* Chart roles. Observed telemetry is cyan; percentiles step light→bright on one hue. */
export const CHART = {
  signal: "#36d6e7",
  signalDim: "#1b8f9d",
  signalBright: "#a5f3fc",
  compare: "#5f6880",
  intel: "#8b7cf6",
  anomaly: "#f43f5e",
  grid: "rgba(148,163,196,0.07)",
};

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  type?: "area" | "line";
  dashed?: boolean;
  width?: number;
}

export interface Band {
  x1: number;
  x2: number;
  color?: string;
  label?: string;
}

export interface Marker {
  t: number;
  label: string;
  color: string;
}

const tickTime = (range: number) => (t: number) => {
  const d = new Date(t);
  if (range > 36 * 3600_000) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return formatClock(t, false);
};

function useMountAnimation(dep: unknown) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(true);
    const t = setTimeout(() => setOn(false), 900);
    return () => clearTimeout(t);
  }, [dep]);
  return on;
}

interface TooltipPayload {
  dataKey: string;
  value: number;
  color: string;
  name: string;
  payload: Record<string, number>;
}

function ChartTooltip({ active, payload, label, series, format }: { active?: boolean; payload?: TooltipPayload[]; label?: number; series: SeriesDef[]; format: (v: number) => string }) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div className="glass min-w-[150px] rounded-[8px] px-3 py-2">
      <p className="mb-1.5 text-[11px] font-medium text-ink-subtle">{new Date(label).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</p>
      <div className="space-y-1">
        {series.map((s) => {
          const p = payload.find((x) => x.dataKey === s.key);
          if (!p || p.value === undefined || p.value === null) return null;
          return (
            <div key={s.key} className="flex items-center justify-between gap-4 text-[12px]">
              <span className="flex items-center gap-1.5 text-ink-muted">
                <span className={cn("h-[3px] w-2.5 rounded-full")} style={{ background: s.color, opacity: s.dashed ? 0.7 : 1 }} />
                {s.label}
              </span>
              <span className="tabular font-medium text-ink">{format(p.value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimeSeriesChart({
  data,
  series,
  height = 220,
  format = (v) => v.toFixed(0),
  yFormat,
  bands = [],
  markers = [],
  yDomain,
  animateKey,
  className,
  syncId,
}: {
  data: Record<string, number>[];
  series: SeriesDef[];
  height?: number;
  format?: (v: number) => string;
  yFormat?: (v: number) => string;
  bands?: Band[];
  markers?: Marker[];
  yDomain?: [number | "auto" | "dataMin" | "dataMax" | ((v: number) => number), number | "auto" | "dataMin" | "dataMax" | ((v: number) => number)];
  animateKey?: unknown;
  className?: string;
  syncId?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const anim = useMountAnimation(animateKey);
  const range = data.length > 1 ? data[data.length - 1]!.t! - data[0]!.t! : 3600_000;
  const xMin = data[0]?.t ?? 0;
  const xMax = data[data.length - 1]?.t ?? 0;
  const visibleMarkers = markers.filter((m) => m.t >= xMin && m.t <= xMax);
  const visibleBands = bands.map((b) => ({ ...b, x1: Math.max(b.x1, xMin), x2: Math.min(b.x2, xMax) })).filter((b) => b.x2 > b.x1);

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 14, right: 6, left: 0, bottom: 0 }} syncId={syncId}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={tickTime(range)}
            tickLine={false}
            axisLine={false}
            minTickGap={56}
            tickMargin={8}
            fontSize={11}
          />
          <YAxis width={46} tickFormatter={yFormat ?? format} tickLine={false} axisLine={false} fontSize={11} domain={yDomain ?? [0, "auto"]} tickCount={4} />
          <Tooltip
            content={<ChartTooltip series={series} format={format} />}
            cursor={{ stroke: "rgba(148,163,196,0.32)", strokeWidth: 1, strokeDasharray: "3 3" }}
            isAnimationActive={false}
            wrapperStyle={{ outline: "none", zIndex: 20 }}
          />
          {visibleBands.map((b, i) => (
            <ReferenceArea key={`b${i}`} x1={b.x1} x2={b.x2} fill={b.color ?? CHART.anomaly} fillOpacity={0.07} stroke={b.color ?? CHART.anomaly} strokeOpacity={0.22} strokeDasharray="2 3" ifOverflow="hidden" />
          ))}
          {visibleMarkers.map((m) => (
            <ReferenceLine
              key={`${m.label}-${m.t}`}
              x={m.t}
              stroke={m.color}
              strokeOpacity={0.75}
              strokeDasharray="3 3"
              label={{ value: m.label, position: "insideTopLeft", fill: m.color, fontSize: 10, fontFamily: "var(--font-geist-mono)", dy: -12 }}
            />
          ))}
          {series.map((s) =>
            s.type === "line" ? (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                type="monotone"
                stroke={s.color}
                strokeWidth={s.width ?? 1.75}
                strokeDasharray={s.dashed ? "4 4" : undefined}
                strokeOpacity={s.dashed ? 0.7 : 1}
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 2, stroke: "#0c1019", fill: s.color }}
                isAnimationActive={anim}
                animationDuration={700}
              />
            ) : (
              <Area
                key={s.key}
                dataKey={s.key}
                name={s.label}
                type="monotone"
                stroke={s.color}
                strokeWidth={s.width ?? 1.75}
                fill={`url(#${uid}-${s.key})`}
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 2, stroke: "#0c1019", fill: s.color }}
                isAnimationActive={anim}
                animationDuration={700}
              />
            )
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string; value?: string; dashed?: boolean }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          <span className="h-[3px] w-3 rounded-full" style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 3px, transparent 3px 5px)` : i.color }} />
          {i.label}
          {i.value && <span className="tabular font-medium text-ink">{i.value}</span>}
        </span>
      ))}
    </div>
  );
}

/* ───────────── Sparkline (SVG, cheap enough for dozens on a page) ───────────── */

export function Sparkline({ values, color = CHART.signal, height = 28, className, fill = true, highlight }: { values: number[]; color?: string; height?: number; className?: string; fill?: boolean; highlight?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const { line, area, last } = useMemo(() => {
    if (values.length < 2) return { line: "", area: "", last: null as null | [number, number] };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || Math.abs(max) * 0.1 || 1;
    const W = 100;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * W, height - 2 - ((v - min) / span) * (height - 5)] as [number, number]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("");
    return { line, area: `${line}L${W},${height}L0,${height}Z`, last: pts[pts.length - 1]! };
  }, [values, height]);
  if (!line) return <div className={className} style={{ height }} />;
  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`sg-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {fill && <path d={area} fill={`url(#sg-${uid})`} />}
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {highlight && last && (
        <span
          className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel"
          style={{ left: `${last[0]}%`, top: `${(last[1] / height) * 100}%`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      )}
    </div>
  );
}

/* ───────────── Log volume histogram ───────────── */

export const LEVEL_COLOR: Record<string, string> = {
  DEBUG: "#3c4458",
  INFO: "#4b5876",
  WARN: "#fbbf24",
  ERROR: "#f43f5e",
  FATAL: "#ff2d6f",
};

export function LogHistogram({
  data,
  height = 92,
  onSelect,
}: {
  data: { t: number; end: number; DEBUG: number; INFO: number; WARN: number; ERROR: number; FATAL: number }[];
  height?: number;
  onSelect?: (from: number, to: number) => void;
}) {
  const range = data.length ? data[data.length - 1]!.end - data[0]!.t : 3600_000;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          barCategoryGap={1}
          onClick={(e) => {
            const p = (e as unknown as { activePayload?: { payload: { t: number; end: number } }[] })?.activePayload?.[0]?.payload;
            if (p && onSelect) onSelect(p.t, p.end);
          }}
        >
          <XAxis dataKey="t" tickFormatter={tickTime(range)} tickLine={false} axisLine={false} minTickGap={64} fontSize={10.5} tickMargin={6} />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "rgba(148,163,196,0.06)" }}
            isAnimationActive={false}
            wrapperStyle={{ outline: "none" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as Record<string, number>;
              return (
                <div className="glass rounded-[8px] px-3 py-2 text-[12px]">
                  <p className="mb-1 text-[11px] text-ink-subtle">
                    {formatClock(p.t!)} to {formatClock(p.end!)}
                  </p>
                  {(["FATAL", "ERROR", "WARN", "INFO", "DEBUG"] as const).map((l) =>
                    p[l] ? (
                      <p key={l} className="flex justify-between gap-6">
                        <span className="flex items-center gap-1.5 text-ink-muted">
                          <span className="h-2 w-2 rounded-[2px]" style={{ background: LEVEL_COLOR[l] }} />
                          {l}
                        </span>
                        <span className="tabular text-ink">{p[l]}</span>
                      </p>
                    ) : null
                  )}
                  {onSelect && <p className="mt-1.5 text-[10.5px] text-ink-subtle">Click to zoom into this window</p>}
                </div>
              );
            }}
          />
          {(["DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const).map((l, i, arr) => (
            <Bar key={l} dataKey={l} stackId="a" fill={LEVEL_COLOR[l]} radius={i === arr.length - 1 ? [2, 2, 0, 0] : 0} isAnimationActive={false} className={onSelect ? "cursor-pointer" : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
