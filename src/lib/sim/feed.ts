import { SERVICES, SERVICE_INDEX } from "@/lib/catalog/services";
import { detectAdaptive } from "@/lib/analytics/anomaly";
import type { ChangeEvent, FeedEvent, Incident, Tone } from "@/lib/types";
import { buildTimes, serviceSeries } from "./telemetry";
import { pick, rand } from "./random";
import { formatSigma } from "@/lib/utils";

const INFRA: { text: (svc: string, r: () => number) => string; tone: Tone; kind: FeedEvent["kind"] }[] = [
  { text: (s, r) => `Autoscaler scaled ${s} ${6 + Math.floor(r() * 6)} → ${9 + Math.floor(r() * 6)} replicas`, tone: "info", kind: "scale" },
  { text: (s, r) => `Autoscaler scaled ${s} down by ${1 + Math.floor(r() * 3)} replicas (CPU ${30 + Math.floor(r() * 15)}%)`, tone: "neutral", kind: "scale" },
  { text: (s) => `Synthetic check passed for ${s} in 6/6 regions`, tone: "good", kind: "info" },
  { text: (s, r) => `Canary for ${s} promoted after ${10 + Math.floor(r() * 20)}m clean bake`, tone: "good", kind: "deploy" },
  { text: (s, r) => `Node pool rotation: drained ip-10-42-${Math.floor(r() * 250)}-${Math.floor(r() * 250)} (${s})`, tone: "neutral", kind: "info" },
  { text: (s, r) => `Certificate for ${s}.internal renewed (expires in ${60 + Math.floor(r() * 30)}d)`, tone: "neutral", kind: "info" },
  { text: (s, r) => `SLO burn rate for ${s} at ${(0.2 + r() * 0.6).toFixed(1)}× (within budget)`, tone: "neutral", kind: "info" },
];

const BUCKET = 50_000;

export function buildFeed(now: number, incidents: Incident[], changes: ChangeEvent[], windowMs = 45 * 60_000): FeedEvent[] {
  const from = now - windowMs;
  const out: FeedEvent[] = [];

  for (const c of changes) {
    if (c.at < from || c.at > now) continue;
    out.push({
      id: `f-${c.id}`,
      t: c.at,
      kind: c.kind === "deploy" ? "deploy" : "config",
      tone: "info",
      service: c.service,
      message: c.kind === "deploy" ? `Deployed ${c.service} ${c.version ?? ""}: ${c.summary}` : `${labelForChange(c.kind)} on ${c.service}: ${c.summary}`,
    });
  }

  for (const inc of incidents) {
    for (const e of inc.timeline) {
      if (e.at < from || e.at > now) continue;
      if (e.type === "note") continue;
      const tone: Tone =
        e.type === "resolved" ? "good" : e.type === "detected" || e.type === "alert" ? (inc.severity === "SEV-1" || inc.severity === "SEV-2" ? "critical" : "warning") : "info";
      out.push({
        id: `f-${e.id}`,
        t: e.at,
        kind: e.type === "resolved" ? "recovery" : "incident",
        tone,
        message: `${inc.id} · ${e.message}`,
        href: `/incidents/${inc.id}`,
      });
    }
  }

  // synthetic infrastructure chatter
  for (let b = Math.floor(from / BUCKET); b <= Math.floor(now / BUCKET); b++) {
    if (rand(b, 41) > 0.5) continue;
    const t = b * BUCKET + Math.floor(rand(b, 42) * BUCKET);
    if (t < from || t > now) continue;
    let i = 0;
    const r = () => rand(b, 43, ++i);
    const svc = pick(SERVICES, r()).id;
    const tpl = pick(INFRA, r());
    out.push({ id: `f-i${b}`, t, kind: tpl.kind, tone: tpl.tone, service: svc, message: tpl.text(svc, r) });
  }

  // live anomaly detections & recoveries from actual telemetry
  const times = buildTimes(now, windowMs, 20_000, 40);
  for (const svc of SERVICES) {
    const series = serviceSeries(svc.id, times, incidents);
    for (const metric of ["errorRate", "p99"] as const) {
      const det = detectAdaptive(
        series.map((p) => ({ t: p.t, v: p[metric] })),
        { window: 40, threshold: 4, minRun: 3, minRelative: metric === "errorRate" ? 1.5 : 0.6, adaptAfter: Infinity }
      );
      for (const seg of det.segments) {
        if (seg.start >= from) {
          out.push({
            id: `f-a${SERVICE_INDEX[svc.id]}-${metric}-${seg.start}`,
            t: seg.start,
            kind: "anomaly",
            tone: "warning",
            service: svc.id,
            message: `Anomaly: ${metric === "p99" ? "p99 latency" : "error rate"} on ${svc.id} is ${formatSigma(seg.peakZ)} above its rolling baseline`,
          });
        }
        if (seg.end < now - 60_000 && seg.end >= from) {
          out.push({
            id: `f-r${SERVICE_INDEX[svc.id]}-${metric}-${seg.end}`,
            t: seg.end + 20_000,
            kind: "recovery",
            tone: "good",
            service: svc.id,
            message: `${metric === "p99" ? "p99 latency" : "Error rate"} on ${svc.id} returned to baseline`,
          });
        }
      }
    }
  }

  return out.sort((a, b) => b.t - a.t).slice(0, 60);
}

function labelForChange(kind: ChangeEvent["kind"]) {
  return kind === "config" ? "Config change" : kind === "flag" ? "Feature flag" : kind === "infra" ? "Infrastructure" : "Deploy";
}
