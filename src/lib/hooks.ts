"use client";

import { useEffect, useMemo, useState } from "react";
import { SERVICES } from "@/lib/catalog/services";
import { allHealth, healthScore, type ServiceHealth } from "@/lib/analytics/health";
import { useSentinel } from "@/lib/store";
import { RANGE_MS, RANGE_STEP, buildTimes, sampleMetrics, serviceSeries } from "@/lib/sim/telemetry";
import type { Incident, MetricPoint, TimeRange } from "@/lib/types";

export function useNow() {
  return useSentinel((s) => s.now);
}

export function useReady() {
  return useSentinel((s) => s.hydrated);
}

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export interface Telemetry {
  range: TimeRange;
  times: number[];
  series: Record<string, MetricPoint[]>;
  snapshot: Record<string, MetricPoint>;
  health: ServiceHealth[];
  score: number;
  active: Incident[];
}

/* small shared cache so several widgets on one page reuse the same computation */
const cache = new Map<string, { incidents: Incident[]; value: Telemetry }>();

export function computeTelemetry(now: number, range: TimeRange, incidents: Incident[], prefix = 0): Telemetry {
  const key = `${now}|${range}|${prefix}`;
  const hit = cache.get(key);
  if (hit && hit.incidents === incidents) return hit.value;
  const times = buildTimes(now, RANGE_MS[range], RANGE_STEP[range], prefix);
  const series: Record<string, MetricPoint[]> = {};
  const snapshot: Record<string, MetricPoint> = {};
  for (const s of SERVICES) {
    series[s.id] = serviceSeries(s.id, times, incidents);
    snapshot[s.id] = sampleMetrics(s, now, incidents);
  }
  const active = incidents.filter((i) => i.status !== "resolved");
  const health = allHealth(snapshot);
  const value: Telemetry = { range, times, series, snapshot, health, score: healthScore(health, active), active };
  cache.set(key, { incidents, value });
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return value;
}

export function useTelemetry(range: TimeRange, prefix = 0): Telemetry | null {
  const now = useSentinel((s) => s.now);
  const incidents = useSentinel((s) => s.incidents);
  const ready = useSentinel((s) => s.hydrated);
  return useMemo(() => (ready && now ? computeTelemetry(now, range, incidents, prefix) : null), [ready, now, range, incidents, prefix]);
}

/** live platform health (snapshot only, cheap) */
export function usePlatformHealth() {
  const now = useSentinel((s) => s.now);
  const incidents = useSentinel((s) => s.incidents);
  const ready = useSentinel((s) => s.hydrated);
  return useMemo(() => {
    if (!ready || !now) return null;
    const snap: Record<string, MetricPoint> = {};
    for (const s of SERVICES) snap[s.id] = sampleMetrics(s, now, incidents);
    const active = incidents.filter((i) => i.status !== "resolved");
    const health = allHealth(snap);
    return { snapshot: snap, health, score: healthScore(health, active), active };
  }, [ready, now, incidents]);
}

export function useKeyHandler(handler: (e: KeyboardEvent) => void, deps: unknown[] = []) {
  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
