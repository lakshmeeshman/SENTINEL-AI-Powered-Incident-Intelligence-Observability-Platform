import { SERVICES, SERVICE_MAP } from "@/lib/catalog/services";
import type { Incident, MetricPoint, ServiceDef, Severity, Tone } from "@/lib/types";

export type HealthStatus = "healthy" | "degraded" | "critical";

export interface ServiceHealth {
  id: string;
  status: HealthStatus;
  reasons: string[];
  metrics: MetricPoint;
}

export function serviceHealth(svc: ServiceDef, m: MetricPoint): ServiceHealth {
  const b = svc.baseline;
  const reasons: string[] = [];
  let status: HealthStatus = "healthy";
  const latRatio = m.p99 / b.p99;
  if (m.errorRate >= 4 || latRatio >= 3.5) status = "critical";
  else if (m.errorRate >= 1 || latRatio >= 1.9 || m.cpu >= 88 || m.mem >= 90) status = "degraded";
  if (m.errorRate >= 1) reasons.push(`error rate ${m.errorRate.toFixed(1)}%`);
  if (latRatio >= 1.9) reasons.push(`p99 ${latRatio.toFixed(1)}× baseline`);
  if (m.cpu >= 88) reasons.push(`CPU ${m.cpu.toFixed(0)}%`);
  if (m.mem >= 90) reasons.push(`memory ${m.mem.toFixed(0)}%`);
  if (m.rps < b.rps * 0.45) reasons.push("traffic drop");
  return { id: svc.id, status, reasons, metrics: m };
}

export function allHealth(snap: Record<string, MetricPoint>): ServiceHealth[] {
  return SERVICES.map((s) => serviceHealth(s, snap[s.id]!));
}

const SEV_PENALTY: Record<Severity, number> = { "SEV-1": 14, "SEV-2": 8, "SEV-3": 3, "SEV-4": 1 };

/**
 * 0–100. Penalties from service state (weighted by tier) and open incidents are summed,
 * then mapped through an exponential so the score degrades smoothly and never collapses
 * to zero for a single contained incident.
 */
export function healthScore(health: ServiceHealth[], active: Incident[]): number {
  let penalty = 0;
  for (const h of health) {
    const tier = SERVICE_MAP[h.id]?.tier;
    const w = tier === "critical" ? 1.4 : tier === "high" ? 1 : 0.7;
    if (h.status === "critical") penalty += 5 * w;
    else if (h.status === "degraded") penalty += 2 * w;
    penalty += Math.min(1.5, h.metrics.errorRate * 0.4) * w * 0.4;
  }
  for (const i of active) penalty += SEV_PENALTY[i.severity];
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-penalty / 75))));
}

export function scoreTone(score: number): Tone {
  if (score >= 90) return "good";
  if (score >= 75) return "warning";
  if (score >= 50) return "serious";
  return "critical";
}

export function scoreLabel(score: number): string {
  if (score >= 90) return "Operational";
  if (score >= 75) return "Minor degradation";
  if (score >= 50) return "Degraded";
  return "Major outage";
}

export function statusTone(s: HealthStatus): Tone {
  return s === "healthy" ? "good" : s === "degraded" ? "warning" : "critical";
}

export const STATUS_LABEL: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
};
