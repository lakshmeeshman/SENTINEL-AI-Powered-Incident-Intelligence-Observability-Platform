import { SCENARIO_MAP } from "@/lib/catalog/scenarios";
import { SERVICES, ownerFor } from "@/lib/catalog/services";
import type { AppNotification, ChangeEvent, Incident, IncidentStatus, Severity, TimelineEvent } from "@/lib/types";
import { buildSimTimeline, symptomaticServices } from "./factory";
import { mulberry32 } from "./random";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface SeedSpec {
  id: string;
  scenarioId: string;
  agoMin: number;
  status: IncidentStatus;
  durationMin?: number;
  magnitude?: number;
  severity?: Severity;
  title?: number;
}

const SPECS: SeedSpec[] = [
  { id: "INC-2047", scenarioId: "db-pool-exhaustion", agoMin: 19, status: "investigating", magnitude: 1.0 },
  { id: "INC-2046", scenarioId: "kafka-consumer-lag", agoMin: 52, status: "identified", magnitude: 0.95 },
  { id: "INC-2045", scenarioId: "search-slow-queries", agoMin: 128, status: "monitoring", magnitude: 0.9, durationMin: 95 },
  { id: "INC-2044", scenarioId: "cache-stampede", agoMin: 5 * 60 + 40, status: "resolved", durationMin: 26, magnitude: 1.05 },
  { id: "INC-2043", scenarioId: "rate-limit-misconfig", agoMin: 14 * 60 + 10, status: "resolved", durationMin: 19 },
  { id: "INC-2042", scenarioId: "bad-deploy", agoMin: DAY / MIN + 3 * 60, status: "resolved", durationMin: 38, magnitude: 1.1 },
  { id: "INC-2041", scenarioId: "memory-leak", agoMin: 2 * DAY / MIN + 20 * 60, status: "resolved", durationMin: 72 },
  { id: "INC-2040", scenarioId: "tls-cert-expiry", agoMin: 3 * DAY / MIN + 8 * 60, status: "resolved", durationMin: 44 },
  { id: "INC-2039", scenarioId: "idp-latency", agoMin: 4 * DAY / MIN + 60, status: "resolved", durationMin: 55, severity: "SEV-3" },
  { id: "INC-2038", scenarioId: "inventory-lock-contention", agoMin: 5 * DAY / MIN + 22 * 60, status: "resolved", durationMin: 31 },
  { id: "INC-2037", scenarioId: "db-pool-exhaustion", agoMin: 6 * DAY / MIN + 5 * 60, status: "resolved", durationMin: 23, magnitude: 0.8, severity: "SEV-3", title: 1 },
];

const ROUTINE = [
  "Bump grpc-go to 1.66.2",
  "Add tracing spans to request handlers",
  "Tune GC settings for p99",
  "Refactor config loader",
  "Upgrade base image to distroless 2026-11",
  "Add structured error codes",
  "Increase readiness probe timeout",
  "Backfill missing indexes",
  "Rotate service credentials",
  "Enable HTTP/2 keepalive",
  "Improve retry jitter",
  "Feature: saved searches",
  "Remove deprecated v1 endpoints",
  "Bump OpenTelemetry SDK",
];

export interface SeedData {
  incidents: Incident[];
  changes: ChangeEvent[];
  notifications: AppNotification[];
}

export function buildSeed(now: number): SeedData {
  const rnd = mulberry32(20470);
  const incidents: Incident[] = [];
  const changes: ChangeEvent[] = [];

  for (const spec of SPECS) {
    const sc = SCENARIO_MAP[spec.scenarioId]!;
    const commander = ownerFor(sc.origin);
    const impactStartedAt = now - spec.agoMin * MIN;
    const detectedAt = impactStartedAt + (55 + rnd() * 90) * 1000;
    const acknowledgedAt = detectedAt + (70 + rnd() * 160) * 1000;
    let mitigatedAt: number | undefined;
    let resolvedAt: number | undefined;
    if (spec.status === "monitoring") mitigatedAt = now - 24 * MIN;
    if (spec.status === "resolved") {
      const dur = (spec.durationMin ?? 30) * MIN;
      mitigatedAt = impactStartedAt + dur * 0.78;
      resolvedAt = impactStartedAt + dur;
    }

    const timeline: TimelineEvent[] = buildSimTimeline({
      id: spec.id,
      sc,
      status: spec.status,
      impactStartedAt,
      detectedAt,
      acknowledgedAt,
      mitigatedAt,
      resolvedAt,
      commander,
      now,
    });

    if (sc.change) {
      const lead = sc.change.leadMin[0] + rnd() * (sc.change.leadMin[1] - sc.change.leadMin[0]);
      const svc = sc.change.service ?? sc.origin;
      changes.push({
        id: `chg-${spec.id}`,
        at: impactStartedAt - lead * MIN,
        service: svc,
        kind: sc.change.kind,
        version: sc.change.version,
        author: ownerFor(svc),
        summary: sc.change.summary,
      });
      if (sc.change.kind === "deploy" && mitigatedAt && mitigatedAt < now) {
        changes.push({
          id: `chg-${spec.id}-rb`,
          at: mitigatedAt - 90_000,
          service: svc,
          kind: "deploy",
          version: SERVICES.find((s) => s.id === svc)?.version,
          author: commander,
          summary: `Rollback to ${SERVICES.find((s) => s.id === svc)?.version} (${spec.id})`,
        });
      }
    }

    incidents.push({
      id: spec.id,
      title: sc.titles[spec.title ?? 0]!,
      severity: spec.severity ?? sc.severity,
      status: spec.status,
      description: sc.description,
      affectedServices: symptomaticServices(sc),
      impactStartedAt,
      detectedAt,
      acknowledgedAt,
      mitigatedAt,
      resolvedAt,
      commander,
      source: "detector",
      tags: sc.tags,
      timeline,
      resolutionNote: spec.status === "resolved" ? sc.notes.resolution : undefined,
      sim: { scenarioId: sc.id, magnitude: spec.magnitude ?? 1 },
    });
  }

  // routine change traffic over the last 7 days
  for (let i = 0; i < 46; i++) {
    const svc = SERVICES[Math.floor(rnd() * SERVICES.length)]!;
    const at = now - rnd() * 7 * DAY;
    const isConfig = rnd() < 0.22;
    const [maj, min, patch] = svc.version.replace(/^v/, "").split(".").map((x) => Number(x) || 0);
    changes.push({
      id: `chg-r${i}`,
      at,
      service: svc.id,
      kind: isConfig ? "config" : "deploy",
      version: isConfig ? undefined : `v${maj}.${min}.${(patch ?? 0) + 1 + Math.floor(rnd() * 3)}`,
      author: ownerFor(svc.id),
      summary: isConfig ? `Update ${svc.id} autoscaling target (CPU ${55 + Math.floor(rnd() * 15)}%)` : ROUTINE[Math.floor(rnd() * ROUTINE.length)]!,
    });
  }
  changes.sort((a, b) => b.at - a.at);

  const notifications: AppNotification[] = [
    {
      id: "n-2047",
      t: incidents[0]!.detectedAt,
      title: "INC-2047 opened (SEV-2)",
      body: incidents[0]!.title,
      severity: "SEV-2",
      incidentId: "INC-2047",
      read: false,
    },
    {
      id: "n-2046",
      t: incidents[1]!.acknowledgedAt!,
      title: "INC-2046 acknowledged",
      body: `${incidents[1]!.commander} is incident commander.`,
      severity: "SEV-3",
      incidentId: "INC-2046",
      read: false,
    },
    {
      id: "n-2045",
      t: incidents[2]!.mitigatedAt!,
      title: "INC-2045 is now monitoring",
      body: "Mitigation applied on search-index shard 3.",
      severity: "SEV-4",
      incidentId: "INC-2045",
      read: true,
    },
    {
      id: "n-2044",
      t: incidents[3]!.resolvedAt!,
      title: "INC-2044 resolved",
      body: incidents[3]!.title,
      severity: "SEV-2",
      incidentId: "INC-2044",
      read: true,
    },
  ];

  return { incidents, changes, notifications };
}
