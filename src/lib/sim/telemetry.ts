import { SERVICES, SERVICE_INDEX, SERVICE_MAP, downstreamOf, upstreamOf } from "@/lib/catalog/services";
import { SCENARIO_MAP, type Effect } from "@/lib/catalog/scenarios";
import type { Incident, MetricKey, MetricPoint, ServiceDef, TimeRange } from "@/lib/types";
import { clamp, smoothstep } from "@/lib/utils";
import { fbm, rand, strHash, valueNoise } from "./random";

/*
 * Telemetry is a pure function of (service, time, incidents).
 *   metric(t) = baseline × diurnal load × organic noise ⊕ Σ incident effects
 * Incident effects ramp in, plateau with jitter, and decay on mitigation/resolution.
 * They propagate up the call graph (callers inherit attenuated latency/errors) and,
 * for edge/gateway failures, down it (callees see less traffic).
 */

export const RANGE_MS: Record<TimeRange, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

export const RANGE_STEP: Record<TimeRange, number> = {
  "15m": 5_000,
  "1h": 20_000,
  "6h": 120_000,
  "24h": 480_000,
};

const RAMP_MS = 150_000;
/** symptoms reach each additional hop of the call graph this much later */
export const HOP_DELAY_MS = 35_000;
const DECAY_MS = 180_000;

/* ───────────── impact topology ───────────── */

const impactCache = new Map<string, Map<string, Effect>>();

export function impactMap(scenarioId: string): Map<string, Effect> {
  const cached = impactCache.get(scenarioId);
  if (cached) return cached;
  const sc = SCENARIO_MAP[scenarioId];
  const out = new Map<string, Effect>();
  if (!sc) return out;
  out.set(sc.origin, { ...sc.signature.origin, hop: 0 });
  if (sc.signature.callers) {
    for (const [svc, hop] of upstreamOf(sc.origin, 3)) {
      if (hop === 0) continue;
      const f = Math.pow(0.6, hop - 1);
      const c = sc.signature.callers;
      out.set(svc, {
        latency: c.latency * f,
        errors: c.errors * f * (hop > 1 ? 0.7 : 1),
        traffic: hop === 1 ? c.traffic ?? 0 : (c.traffic ?? 0) * 0.5,
        hop,
      });
    }
  }
  for (const [svc, eff] of Object.entries(sc.signature.overrides ?? {})) out.set(svc, { ...eff, hop: out.get(svc)?.hop ?? 1 });
  if (sc.signature.downstreamTraffic) {
    for (const [svc, hop] of downstreamOf(sc.origin, 4)) {
      if (hop === 0) continue;
      const prev = out.get(svc) ?? { latency: 0, errors: 0 };
      out.set(svc, { ...prev, traffic: (prev.traffic ?? 0) + sc.signature.downstreamTraffic * Math.pow(0.85, hop - 1), hop: prev.hop ?? hop });
    }
  }
  impactCache.set(scenarioId, out);
  return out;
}

/** 0..~1.3 — how strongly an incident is affecting the world at time t */
export function incidentIntensity(inc: Incident, t: number): number {
  if (!inc.sim) return 0;
  const start = inc.impactStartedAt;
  if (t < start) return 0;
  let v = smoothstep((t - start) / RAMP_MS);
  if (inc.mitigatedAt && t >= inc.mitigatedAt) v *= 1 - 0.85 * smoothstep((t - inc.mitigatedAt) / DECAY_MS);
  if (inc.resolvedAt && t >= inc.resolvedAt) v *= 1 - smoothstep((t - inc.resolvedAt) / DECAY_MS);
  if (v <= 0.0005) return 0;
  const seed = strHash(inc.id);
  v *= 0.84 + 0.16 * (valueNoise(seed, t, 45_000) * 0.5 + 0.5);
  return v * inc.sim.magnitude;
}

/* ───────────── metric function ───────────── */

/** diurnal load factor: trough ~03:00, peak ~15:00 local time */
export function diurnal(t: number): number {
  const d = new Date(t);
  const h = d.getHours() + d.getMinutes() / 60;
  return 0.74 + 0.26 * Math.sin(((h - 9) / 24) * 2 * Math.PI);
}

export function sampleMetrics(svc: ServiceDef, t: number, incidents: Incident[]): MetricPoint {
  const b = svc.baseline;
  const seed = (SERVICE_INDEX[svc.id] ?? 0) * 977 + 31;
  const load = diurnal(t) * (1 + 0.07 * fbm(seed + 1, t, 300_000));

  let lat = 0;
  let err = 0;
  let traffic = 0;
  let cpu = 0;
  let mem = 0;

  for (const inc of incidents) {
    if (!inc.sim) continue;
    if (t < inc.impactStartedAt) continue;
    if (inc.resolvedAt && t > inc.resolvedAt + DECAY_MS + 1000) continue;
    const eff = impactMap(inc.sim.scenarioId).get(svc.id);
    if (!eff) continue;
    const I = incidentIntensity(inc, t - (eff.hop ?? 0) * HOP_DELAY_MS);
    if (I <= 0) continue;
    lat += eff.latency * I;
    err += eff.errors * I;
    traffic += (eff.traffic ?? 0) * I;
    cpu += (eff.cpu ?? 0) * I;
    if (eff.mem) {
      const sc = SCENARIO_MAP[inc.sim.scenarioId];
      if (sc?.signature.memGrowth && sc.origin === svc.id) {
        // sawtooth: heap grows until the pod is OOMKilled and restarts
        const phase = ((t - inc.impactStartedAt) % 360_000) / 360_000;
        mem += eff.mem * (0.25 + 0.75 * phase) * Math.min(1, I * 1.2);
      } else mem += eff.mem * I;
    }
  }

  // organic micro-blips that are NOT incidents (anomaly detection must tolerate them)
  const blipBucket = Math.floor(t / 300_000);
  if (rand(seed + 7, blipBucket) < 0.04) {
    const into = t - blipBucket * 300_000;
    const off = rand(seed + 8, blipBucket) * 220_000;
    if (into > off && into < off + 35_000) lat += 0.35;
  }

  const loadLat = 1 + 0.32 * (load - 0.9);
  const rps = Math.max(0, b.rps * load * (1 + traffic));
  const p50 = b.p50 * loadLat * (1 + 0.05 * fbm(seed + 2, t, 90_000)) * (1 + lat * 0.55);
  const p95 = Math.max(p50 * 1.6, b.p95 * loadLat * (1 + 0.08 * fbm(seed + 3, t, 70_000)) * (1 + lat * 0.8));
  const p99 = Math.max(p95 * 1.35, b.p99 * loadLat * (1 + 0.12 * fbm(seed + 4, t, 50_000)) * (1 + lat));
  const errorRate = clamp(b.errorRate * (1 + 0.38 * fbm(seed + 5, t, 60_000)) + err, 0, 100);
  const cpuV = clamp(b.cpu * (0.72 + 0.36 * load) + 3.5 * fbm(seed + 6, t, 120_000) + cpu, 1, 99.5);
  const memV = clamp(b.mem + 2.5 * fbm(seed + 9, t, 1_800_000) + mem, 1, 99.5);

  return { t, rps, errorRate, p50, p95, p99, cpu: cpuV, mem: memV };
}

/* ───────────── series helpers ───────────── */

/** aligned timestamps ending at `end` (the last point is `end` itself, so live views move) */
export function buildTimes(end: number, rangeMs: number, step: number, prefixPoints = 0): number[] {
  const last = Math.floor(end / step) * step;
  const n = Math.round(rangeMs / step) + prefixPoints;
  const times: number[] = [];
  for (let i = n - 1; i >= 0; i--) times.push(last - i * step);
  if (end - last > 250) times.push(end);
  return times;
}

export function serviceSeries(serviceId: string, times: number[], incidents: Incident[]): MetricPoint[] {
  const svc = SERVICE_MAP[serviceId];
  if (!svc) return [];
  return times.map((t) => sampleMetrics(svc, t, incidents));
}

export function snapshot(t: number, incidents: Incident[]): Record<string, MetricPoint> {
  const out: Record<string, MetricPoint> = {};
  for (const s of SERVICES) out[s.id] = sampleMetrics(s, t, incidents);
  return out;
}

export function pluck(points: MetricPoint[], key: MetricKey) {
  return points.map((p) => ({ t: p.t, v: p[key] }));
}

export const METRIC_LABEL: Record<MetricKey, string> = {
  rps: "Throughput",
  errorRate: "Error rate",
  p50: "p50 latency",
  p95: "p95 latency",
  p99: "p99 latency",
  cpu: "CPU",
  mem: "Memory",
};
