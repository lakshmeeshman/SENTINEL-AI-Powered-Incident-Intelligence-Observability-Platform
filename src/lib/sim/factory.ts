import { SCENARIOS, SCENARIO_MAP, type Scenario } from "@/lib/catalog/scenarios";
import { SERVICE_MAP, ownerFor } from "@/lib/catalog/services";
import type { ChangeEvent, Incident, IncidentStatus, Severity, TimelineEvent } from "@/lib/types";
import { impactMap } from "./telemetry";

let counter = 0;
export function eid(prefix = "ev") {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function nextIncidentId(incidents: Incident[]): string {
  let max = 2036;
  for (const i of incidents) {
    const n = Number(i.id.replace(/\D/g, ""));
    if (n > max) max = n;
  }
  return `INC-${max + 1}`;
}

/** the symptom a detector would describe first */
export function primarySymptom(sc: Scenario): string {
  const o = sc.signature.origin;
  if (sc.signature.memGrowth) return `memory saturation and restarts on ${sc.origin}`;
  if (o.errors >= 3) return `error rate on ${sc.origin}`;
  if ((sc.signature.downstreamTraffic ?? 0) < -0.2) return `error rate on ${sc.origin} and a downstream traffic drop`;
  return `p99 latency on ${sc.origin}`;
}

/** services with visible symptoms, strongest first (what responders would list) */
export function symptomaticServices(sc: Scenario): string[] {
  const m = impactMap(sc.id);
  return [...m.entries()]
    .map(([id, e]) => ({ id, score: e.errors * 1.2 + e.latency + Math.abs(e.traffic ?? 0) * 3 + (e.mem ?? 0) / 10 }))
    .filter((x) => x.score >= 0.9)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.id);
}

interface TimelinePlan {
  id: string;
  sc: Scenario;
  status: IncidentStatus;
  impactStartedAt: number;
  detectedAt: number;
  acknowledgedAt?: number;
  mitigatedAt?: number;
  resolvedAt?: number;
  commander: string;
  now: number;
}

export function buildSimTimeline(p: TimelinePlan): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const push = (at: number, type: TimelineEvent["type"], actor: string, message: string) => {
    if (at <= p.now) ev.push({ id: `${p.id}-${ev.length}`, at, type, actor, message });
  };
  const team = SERVICE_MAP[p.sc.origin]?.team ?? "Platform";
  push(p.detectedAt, "detected", "Sentinel", `Anomaly detector opened ${p.id}: abnormal ${primarySymptom(p.sc)}.`);
  push(p.detectedAt + 15_000, "alert", "Sentinel", `Paged on-call ${p.commander} (${team} primary).`);
  if (p.acknowledgedAt) {
    push(p.acknowledgedAt, "acknowledged", p.commander, `Acknowledged. ${p.commander.split(" ")[0]} is incident commander.`);
    const end = p.resolvedAt ?? p.mitigatedAt ?? p.now;
    const span = Math.max(4 * 60_000, end - p.acknowledgedAt);
    const order: IncidentStatus[] = ["investigating", "identified", "monitoring", "resolved"];
    const reached = (s: IncidentStatus) => order.indexOf(p.status) >= order.indexOf(s);
    if (reached("investigating")) {
      push(p.acknowledgedAt + 50_000, "status", p.commander, "Status changed to Investigating.");
      push(p.acknowledgedAt + 95_000, "note", p.commander, p.sc.notes.investigating);
    }
    if (reached("identified")) {
      const at = p.acknowledgedAt + span * 0.38;
      push(at, "status", p.commander, "Status changed to Identified.");
      push(at + 20_000, "note", p.commander, p.sc.notes.identified);
    }
    if (reached("monitoring") && p.mitigatedAt) {
      push(p.mitigatedAt - 60_000, "action", p.commander, p.sc.notes.action);
      push(p.mitigatedAt, "status", p.commander, "Mitigation applied. Status changed to Monitoring.");
    }
    if (p.status === "resolved" && p.resolvedAt) {
      push(p.resolvedAt, "resolved", p.commander, p.sc.notes.resolution);
    }
  }
  return ev.sort((a, b) => a.at - b.at);
}

export interface SimulateOptions {
  now: number;
  incidents: Incident[];
  scenarioId?: string;
  random?: () => number;
}

export function createSimulatedIncident({ now, incidents, scenarioId, random = Math.random }: SimulateOptions): {
  incident: Incident;
  change?: ChangeEvent;
} {
  const activeScenarios = new Set(incidents.filter((i) => i.status !== "resolved" && i.sim).map((i) => i.sim!.scenarioId));
  const pool = SCENARIOS.filter((s) => !activeScenarios.has(s.id));
  const sc = (scenarioId && SCENARIO_MAP[scenarioId]) || pool[Math.floor(random() * pool.length)] || SCENARIOS[0]!;
  const id = nextIncidentId(incidents);
  const impactStartedAt = now - 70_000 - Math.floor(random() * 30_000);
  const detectedAt = now;
  const magnitude = 0.85 + random() * 0.4;
  const commander = ownerFor(sc.origin);

  let change: ChangeEvent | undefined;
  if (sc.change) {
    const lead = sc.change.leadMin[0] + random() * (sc.change.leadMin[1] - sc.change.leadMin[0]);
    change = {
      id: eid("chg"),
      at: impactStartedAt - lead * 60_000,
      service: sc.change.service ?? sc.origin,
      kind: sc.change.kind,
      version: sc.change.version,
      author: ownerFor(sc.change.service ?? sc.origin),
      summary: sc.change.summary,
    };
  }

  const incident: Incident = {
    id,
    title: sc.titles[Math.floor(random() * sc.titles.length)]!,
    severity: sc.severity,
    status: "open",
    description: sc.description,
    affectedServices: symptomaticServices(sc),
    impactStartedAt,
    detectedAt,
    source: "simulation",
    tags: [...sc.tags, "simulated"],
    timeline: buildSimTimeline({ id, sc, status: "open", impactStartedAt, detectedAt, commander, now }),
    sim: { scenarioId: sc.id, magnitude },
  };
  // unassigned until someone acknowledges
  incident.timeline = incident.timeline.map((e) => (e.type === "alert" ? { ...e, message: `Paged on-call for ${SERVICE_MAP[sc.origin]?.team ?? "Platform"}. Awaiting acknowledgement.` } : e));
  return { incident, change };
}

export interface ManualIncidentInput {
  title: string;
  severity: Severity;
  description: string;
  services: string[];
  startedMinutesAgo: number;
  commander?: string;
  reporter: string;
}

export function createManualIncident(input: ManualIncidentInput, now: number, incidents: Incident[]): Incident {
  const id = nextIncidentId(incidents);
  const start = now - Math.max(0, input.startedMinutesAgo) * 60_000;
  const timeline: TimelineEvent[] = [
    { id: `${id}-0`, at: now, type: "created", actor: input.reporter, message: `Declared ${id} manually as ${input.severity}.` },
  ];
  if (input.commander) {
    timeline.push({ id: `${id}-1`, at: now + 1, type: "acknowledged", actor: input.commander, message: `${input.commander} assigned as incident commander.` });
  }
  return {
    id,
    title: input.title.trim(),
    severity: input.severity,
    status: input.commander ? "acknowledged" : "open",
    description: input.description.trim(),
    affectedServices: input.services,
    impactStartedAt: start,
    detectedAt: now,
    acknowledgedAt: input.commander ? now : undefined,
    commander: input.commander,
    source: "manual",
    tags: ["manual"],
    timeline,
  };
}
