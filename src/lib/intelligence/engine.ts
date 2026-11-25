import { SERVICES, SERVICE_MAP, callPath, downstreamOf, upstreamOf } from "@/lib/catalog/services";
import { detectAgainstBaseline, slopePerMinute } from "@/lib/analytics/anomaly";
import { generateLogs } from "@/lib/sim/logs";
import { METRIC_LABEL, diurnal, serviceSeries } from "@/lib/sim/telemetry";
import type {
  Analysis,
  ChangeEvent,
  ConfidenceSignal,
  CorrelatedAnomaly,
  Incident,
  LogSignatureHit,
  MetricKey,
  MetricPoint,
  RecommendedAction,
} from "@/lib/types";
import { clamp, formatClock, formatCompact, formatDuration, formatPct, formatSigma } from "@/lib/utils";
import { FAILURE_MODES, MODE_MAP, changeLabel, genericNarrative, type Facts, type FailureMode } from "./knowledge";

/*
 * Sentinel deterministic root-cause engine.
 *
 *  1. Telemetry: for every service, score five metrics against a frozen pre-incident
 *     baseline (robust median/MAD z-scores, min-run filter) to find onset and peak.
 *  2. Onset clustering: keep anomalies whose onset falls near the detection anchor.
 *  3. Origin inference: earliest onset + call-graph consistency (symptoms should appear in
 *     callers after the origin; traffic shadows appear in callees) + component-kind priors.
 *  4. Log forensics: classify WARN/ERROR/FATAL lines against failure-mode signatures,
 *     weighted by temporal proximity to onset.
 *  5. Change correlation: deploys/config/flags inside each failure mode's causal horizon.
 *  6. Confidence: weighted blend of the independent evidence channels.
 *
 * It never reads `incident.sim` (the simulator's ground truth).
 */

export const ENGINE_VERSION = "sentinel-rca 1.4";

const MIN = 60_000;
const STEP = 10_000;

const METRICS: { key: MetricKey; dir: "up" | "down" | "both"; minRel: number; thr: number }[] = [
  { key: "errorRate", dir: "up", minRel: 1.5, thr: 4 },
  { key: "p99", dir: "up", minRel: 0.5, thr: 4 },
  { key: "rps", dir: "both", minRel: 0.2, thr: 4.5 },
  { key: "mem", dir: "up", minRel: 0.13, thr: 4 },
  { key: "cpu", dir: "up", minRel: 0.3, thr: 4.5 },
];

interface Candidate extends CorrelatedAnomaly {
  end: number;
  active: boolean;
}

export interface EngineInput {
  incident: Incident;
  incidents: Incident[];
  changes: ChangeEvent[];
  now: number;
}

function times(from: number, to: number, step: number) {
  const out: number[] = [];
  for (let t = Math.floor(from / step) * step; t <= to; t += step) out.push(t);
  return out;
}

export function analyzeIncident({ incident, incidents, changes, now }: EngineInput): Analysis {
  const manual = incident.source === "manual";
  const anchor = manual ? incident.impactStartedAt : incident.detectedAt;
  const end = incident.resolvedAt ?? now;
  const winStart = anchor - 14 * MIN;
  const winEnd = Math.min(now, Math.max(end + 4 * MIN, anchor + 10 * MIN), anchor + 80 * MIN);
  const baseTimes = times(anchor - 80 * MIN, anchor - 16 * MIN, MIN);
  const winTimes = times(winStart, winEnd, STEP);
  const CLUSTER_BEFORE = (manual ? 10 : 6) * MIN;
  const CLUSTER_AFTER = (manual ? 10 : 6) * MIN;

  /* 1 ─ telemetry anomalies */
  const series: Record<string, { base: MetricPoint[]; win: MetricPoint[] }> = {};
  const candidates: Candidate[] = [];
  for (const svc of SERVICES) {
    const base = serviceSeries(svc.id, baseTimes, incidents);
    const win = serviceSeries(svc.id, winTimes, incidents);
    series[svc.id] = { base, win };
    const nearBase = win.filter((p) => p.t >= anchor - 12 * MIN && p.t < anchor - 3 * MIN);
    for (const m of METRICS) {
      const samples = win.map((p) => ({ t: p.t, v: p[m.key] }));
      const opts = { threshold: m.thr, minRun: 3, direction: m.dir, minRelative: m.minRel } as const;
      const inWin = (seg: { start: number }) => seg.start >= anchor - CLUSTER_BEFORE && seg.start <= anchor + CLUSTER_AFTER;
      const target = anchor - 90_000;
      const closest = <T extends { start: number }>(xs: T[]) => xs.reduce((a, b) => (Math.abs(b.start - target) < Math.abs(a.start - target) ? b : a));

      // pass 1: frozen pre-incident baseline
      const far = detectAgainstBaseline(samples, base.map((p) => p[m.key]), opts);
      let det = far;
      let segs = far.segments.filter((sg) => sg.end >= anchor - 12 * MIN);
      // pass 2: near-term baseline, to catch a new step on top of an already-degraded service
      if (!segs.some(inWin) && nearBase.length >= 20) {
        // relax the relative floor only for error rate (a new failure stacking errors on an already-failing service);
        // latency keeps its floor so organic blips are never mistaken for an onset
        const near = detectAgainstBaseline(samples, nearBase.map((p) => p[m.key]), { ...opts, minRun: m.key === "errorRate" ? 3 : 4, minRelative: m.key === "errorRate" ? m.minRel * 0.4 : m.minRel });
        // only steps that are still in progress count; transient blips have already ended
        const nearSegs = near.segments.filter((sg) => inWin(sg) && sg.end >= winEnd - 2 * STEP);
        if (nearSegs.length) {
          det = near;
          segs = nearSegs;
        }
      }
      if (!segs.length) continue;
      const windowed = segs.filter(inWin);
      const first = windowed.length ? closest(windowed) : segs[0]!;
      const peak = segs.reduce((a, b) => (Math.abs(b.peakZ) > Math.abs(a.peakZ) ? b : a));
      const last = segs[segs.length - 1]!;
      candidates.push({
        service: svc.id,
        metric: m.key,
        onset: first.start,
        offsetSec: 0,
        peakZ: peak.peakZ,
        baseline: det.stats.median,
        peak: peak.peakValue,
        ratio: peak.peakValue / Math.max(det.stats.median, 1e-6),
        end: last.end,
        active: last.end >= winEnd - STEP * 2,
      });
    }
  }

  /* 2 ─ onset clustering */
  let cluster = candidates.filter((c) => c.onset >= anchor - CLUSTER_BEFORE && c.onset <= anchor + CLUSTER_AFTER);
  let preExisting = false;
  const strength = (xs: Candidate[]) => xs.reduce((a, c) => a + Math.min(10, Math.abs(c.peakZ)), 0);
  const ongoing = candidates.filter((c) => c.end >= anchor && c.onset < anchor - CLUSTER_BEFORE);
  // a manual report filed during a larger, already-running anomaly is most likely the same event
  if (!cluster.length || (manual && strength(ongoing) > strength(cluster) * 1.5)) {
    cluster = ongoing.length ? ongoing : cluster;
    preExisting = ongoing.length > 0;
  }
  cluster.sort((a, b) => a.onset - b.onset || Math.abs(b.peakZ) - Math.abs(a.peakZ));
  const clusterServices = [...new Set(cluster.map((c) => c.service))];
  const firstOnset = cluster[0]?.onset ?? anchor;
  const estStart = cluster.length ? firstOnset : incident.impactStartedAt;
  for (const c of cluster) c.offsetSec = Math.round((c.onset - estStart) / 1000);

  /* 4 ─ log forensics (needed by origin priors) */
  const logs = generateLogs({ from: winStart, to: winEnd, incidents, budget: 1800 });
  const problems = logs.filter((l) => l.level === "WARN" || l.level === "ERROR" || l.level === "FATAL");
  const hitMap = new Map<string, LogSignatureHit & { mode: string; firstSeen: number }>();
  let unclassified = 0;
  for (const l of problems) {
    let matched = false;
    for (const mode of FAILURE_MODES) {
      for (const sig of mode.signatures) {
        if (!sig.re.test(l.message)) continue;
        matched = true;
        const key = `${mode.id}|${sig.id}|${l.service}`;
        const h = hitMap.get(key);
        if (h) {
          h.count++;
          if (l.t < h.firstSeen) {
            h.firstSeen = l.t;
          }
        } else {
          hitMap.set(key, { signatureId: sig.id, label: sig.label, service: l.service, count: 1, sample: l.message, level: l.level, mode: mode.id, firstSeen: l.t });
        }
        break;
      }
      if (matched) break;
    }
    if (!matched && l.level !== "WARN") unclassified++;
  }
  const hits = [...hitMap.values()];
  // signatures already present well before onset are background from another event, not fresh evidence
  const fresh = (t: number) => Math.exp(-Math.max(0, Math.abs(t - estStart) - 90_000) / (4 * MIN));
  const allBackground = hits.length > 0 && hits.every((h) => h.firstSeen < estStart - 4 * MIN);
  const tw = (t: number) => (t < estStart - 4 * MIN ? (allBackground || preExisting ? 0.5 : 0) : fresh(t));
  const modeScores = new Map<string, { weighted: number; count: number }>();
  for (const h of hits) {
    const cur = modeScores.get(h.mode) ?? { weighted: 0, count: 0 };
    cur.weighted += h.count * tw(h.firstSeen);
    cur.count += h.count;
    modeScores.set(h.mode, cur);
  }

  /* 3 ─ origin inference */
  const lastOnset = cluster.length ? Math.max(...cluster.map((c) => c.onset)) : anchor;
  const span = Math.max(1, lastOnset - firstOnset);
  const onsetOf = (s: string) => Math.min(...cluster.filter((c) => c.service === s).map((c) => c.onset));
  const onlyTrafficDrop = (s: string) => cluster.filter((c) => c.service === s).every((c) => c.metric === "rps" && c.ratio < 1);
  const provisionalMode = [...modeScores.entries()].sort((a, b) => b[1].weighted - a[1].weighted)[0]?.[0];
  const topoScore = (s: string) => {
    const others = clusterServices.filter((o) => o !== s);
    if (!others.length) return 0.5;
    const up = upstreamOf(s, 4);
    const down = downstreamOf(s, 4);
    let explained = 0;
    for (const o of others) if (up.has(o) || (down.has(o) && onlyTrafficDrop(o))) explained++;
    return explained / others.length;
  };
  const scored = clusterServices
    .map((s) => {
      const temporal = clusterServices.length > 1 ? (lastOnset - onsetOf(s)) / span : 1;
      const topo = topoScore(s);
      const mode = provisionalMode ? MODE_MAP[provisionalMode] : undefined;
      const kindMatch = mode?.expect.kinds?.includes(SERVICE_MAP[s]!.kind) ? 1 : 0;
      const modeHits = hits.filter((h) => h.mode === provisionalMode);
      const share = modeHits.length ? modeHits.filter((h) => h.service === s).reduce((a, h) => a + h.count, 0) / modeHits.reduce((a, h) => a + h.count, 0) : 0;
      const shadowPenalty = onlyTrafficDrop(s) ? 0.4 : 0;
      return { s, score: 0.45 * temporal + 0.35 * topo + 0.2 * (kindMatch * 0.7 + share * 0.3) - shadowPenalty };
    })
    .sort((a, b) => b.score - a.score);

  let origin: string | null = scored[0]?.s ?? null;
  // a manual report with no telemetry evidence: fall back to the reported services
  if (!origin && incident.affectedServices.length) origin = null;

  /* mode selection: logs first, keywords as a fallback */
  let mode: FailureMode | undefined;
  const best = [...modeScores.entries()].sort((a, b) => b[1].weighted - a[1].weighted)[0];
  if (best && best[1].weighted >= 1) mode = MODE_MAP[best[0]];
  let keywordMode = false;
  if (!mode && !cluster.length) {
    const text = `${incident.title} ${incident.description}`.toLowerCase();
    let top = { m: undefined as FailureMode | undefined, n: 0 };
    for (const m of FAILURE_MODES) {
      const n = m.keywords.filter((k) => text.includes(k)).length;
      if (n > top.n) top = { m, n };
    }
    if (top.m && top.n >= 1) {
      mode = top.m;
      keywordMode = true;
    }
  }

  /* 5 ─ change correlation */
  const horizon = (mode?.changeHorizonMin ?? 60) * MIN;
  const relevantSvcs = new Set([...clusterServices, ...incident.affectedServices]);
  let change: ChangeEvent | undefined;
  let changeScore = 0;
  for (const c of changes) {
    if (c.at > estStart + MIN || c.at < estStart - horizon) continue;
    if (!relevantSvcs.has(c.service)) continue;
    const lead = estStart - c.at;
    let s = Math.exp(-Math.max(0, lead) / (horizon * 0.55));
    if (c.service === origin) s = Math.min(1, s * 1.15);
    if (c.summary.startsWith("Rollback")) s *= 0.2;
    if (s > changeScore) {
      changeScore = s;
      change = c;
    }
  }
  if (changeScore < 0.12) {
    change = undefined;
    changeScore = 0;
  }
  const changeLeadMin = change ? (estStart - change.at) / MIN : undefined;

  /* facts for narratives */
  const originCands = cluster.filter((c) => c.service === origin);
  const primary = originCands.sort((a, b) => Math.abs(b.peakZ) - Math.abs(a.peakZ))[0];
  const callers = origin ? clusterServices.filter((s) => s !== origin && upstreamOf(origin, 4).has(s)) : [];
  const shadowed = origin ? clusterServices.filter((s) => s !== origin && downstreamOf(origin, 4).has(s) && onlyTrafficDrop(s)) : [];
  const second = clusterServices.length > 1 ? clusterServices.map(onsetOf).sort((a, b) => a - b)[1]! : undefined;
  const leadSec = origin && second !== undefined ? Math.max(0, (second - onsetOf(origin)) / 1000) : 0;
  const modeHits = hits
    .filter((h) => (mode ? h.mode === mode.id : tw(h.firstSeen) > 0.3))
    .sort((a, b) => b.count - a.count);
  const otherHits = hits.filter((h) => !modeHits.includes(h) && tw(h.firstSeen) > 0.3).sort((a, b) => b.count - a.count);

  const facts: Facts = {
    incident,
    origin: origin ?? incident.affectedServices[0] ?? "unknown",
    callers,
    shadowed,
    onset: estStart,
    leadSec,
    metric: primary?.metric ?? "p99",
    ratio: primary?.ratio ?? 1,
    z: primary?.peakZ ?? 0,
    change,
    changeLeadMin,
    hits: modeHits,
    topHit: modeHits[0],
    durationMin: (end - estStart) / MIN,
    loadFactor: diurnal(estStart) / 0.74,
    resolved: incident.status === "resolved",
  };

  /* 6 ─ confidence */
  const totalWeighted = [...modeScores.values()].reduce((a, v) => a + v.weighted, 0);
  const bestW = mode && !keywordMode ? modeScores.get(mode.id)?.weighted ?? 0 : 0;
  const bestCount = mode && !keywordMode ? modeScores.get(mode.id)?.count ?? 0 : 0;
  const logScore = bestW > 0 ? 0.65 * (bestW / (totalWeighted + unclassified * 0.15)) + 0.35 * Math.min(1, bestCount / 30) : 0;
  const temporalScore = clusterServices.length > 1 ? (leadSec > 0 ? Math.min(1, leadSec / 40) : 0.25) : cluster.length ? 0.55 : 0;
  const topologyScore = origin ? topoScore(origin) : 0;
  const expectedMetric: MetricKey | undefined = mode
    ? ({ latency: "p99", errors: "errorRate", memory: "mem", traffic: "rps" } as const)[mode.expect.metric]
    : undefined;
  let shapeScore = 0;
  if (originCands.length) {
    if (!expectedMetric) shapeScore = 0.5;
    else if (primary?.metric === expectedMetric) shapeScore = 1;
    else if (originCands.some((c) => c.metric === expectedMetric)) shapeScore = 0.65;
    else shapeScore = 0.25;
    if (expectedMetric === "mem" && origin) {
      const slope = slopePerMinute(series[origin]!.win.filter((p) => p.t >= estStart).map((p) => ({ t: p.t, v: p.mem })));
      if (slope > 0.05) shapeScore = Math.min(1, shapeScore + 0.15);
    }
  }
  const signals: ConfidenceSignal[] = [
    {
      id: "logs",
      label: "Log signature match",
      weight: 0.3,
      score: clamp(logScore, 0, 1),
      detail: bestCount
        ? `${bestCount} lines match "${mode!.label}" signatures${unclassified ? `, ${unclassified} unclassified errors` : ""}`
        : keywordMode
          ? "No matching log signatures; hypothesis comes from the report text"
          : "No known failure signature in the window",
    },
    {
      id: "temporal",
      label: "Temporal precedence",
      weight: 0.2,
      score: clamp(temporalScore, 0, 1),
      detail: clusterServices.length > 1 ? `${facts.origin} deviated ${Math.round(leadSec)}s before the next service` : cluster.length ? "Single-service anomaly" : "No anomaly onset found",
    },
    {
      id: "topology",
      label: "Dependency consistency",
      weight: 0.2,
      score: clamp(topologyScore, 0, 1),
      detail: clusterServices.length > 1 ? `${Math.round(topologyScore * (clusterServices.length - 1))}/${clusterServices.length - 1} affected services are explained by the call graph` : "Nothing to propagate",
    },
    {
      id: "change",
      label: "Change correlation",
      weight: 0.12,
      score: clamp(changeScore, 0, 1),
      detail: change ? `${changeLabel(change.kind)} on ${change.service} ${Math.round(changeLeadMin!)}m before onset` : "No change inside the causal horizon",
    },
    {
      id: "shape",
      label: "Metric shape",
      weight: 0.18,
      score: clamp(shapeScore, 0, 1),
      detail: primary ? `${METRIC_LABEL[primary.metric]} moved most (${formatSigma(primary.peakZ)})${expectedMetric ? `, expected ${METRIC_LABEL[expectedMetric].toLowerCase()}` : ""}` : "No metric deviation",
    },
  ];
  let confidence = Math.round(100 * signals.reduce((a, s) => a + s.weight * s.score, 0));
  if (preExisting) confidence = Math.round(confidence * 0.85);
  if (keywordMode) confidence = Math.min(confidence + 18, 38);
  confidence = clamp(confidence, cluster.length || keywordMode ? 18 : 8, 97);

  /* narratives */
  let rootCause: Analysis["rootCause"];
  if (mode && (cluster.length || keywordMode)) {
    const rc = mode.rootCause(facts);
    rootCause = {
      title: rc.title,
      detail: keywordMode
        ? `Sentinel found no corroborating anomaly in telemetry around the reported start. Based on the report text, the closest known pattern is "${mode.label}". ${rc.detail}`
        : rc.detail,
      service: origin,
      category: mode.category,
      failureMode: mode.id,
    };
  } else if (cluster.length && origin) {
    const g = genericNarrative(facts);
    rootCause = { title: g.title, detail: g.detail, service: origin, category: g.category, failureMode: null };
  } else {
    rootCause = {
      title: "Insufficient evidence for a root-cause hypothesis",
      detail: `No telemetry anomaly, matching log signature or correlated change was found between ${formatClock(winStart, false)} and ${formatClock(winEnd, false)} for the reported services. Either the impact is below detection thresholds, or the signal lives outside Sentinel's coverage (client-side, third party, or a service that isn't instrumented).`,
      service: null,
      category: "Unknown",
      failureMode: null,
    };
  }

  /* impact */
  const impactEnd = incident.resolvedAt ? Math.min(winEnd, incident.resolvedAt + 4 * MIN) : winEnd;
  const excessIn = (id: string, from: number, to: number) => {
    const s = series[id]!;
    const baseErr = median(s.base.map((p) => p.errorRate));
    let failed = 0;
    for (const p of s.win) if (p.t >= from && p.t <= to) failed += p.rps * Math.max(0, p.errorRate - baseErr) * 0.01 * (STEP / 1000);
    return { failed, baseErr };
  };
  // attribute failures only to this incident's own error anomalies (avoids double-counting concurrent incidents)
  const errorCands = cluster.filter((c) => c.metric === "errorRate");
  const windowFor = (c: Candidate) => [c.onset, Math.min(impactEnd, c.end + 2 * STEP)] as const;
  const entry = errorCands.filter((c) => c.service === "api-gateway" || c.service === "edge-cdn");
  const pool = entry.length ? entry : errorCands;
  const failed = Math.round(Math.max(0, ...pool.map((c) => excessIn(c.service, ...windowFor(c)).failed)));
  const gw = excessIn("api-gateway", estStart, impactEnd);
  const gwBaseRps = median(series["api-gateway"]!.base.map((p) => p.rps));
  const budget = gwBaseRps * 30 * 86400 * 0.0005;
  const burnPct = (failed / budget) * 100;
  const commerceCands = errorCands.filter((c) => c.service === "orders-service" || c.service === "payments-service");
  const revenue = commerceCands.length
    ? Math.round(commerceCands.reduce((a, c) => a + excessIn(c.service, ...windowFor(c)).failed * (c.service === "orders-service" ? 0.04 : 0.12) * 84, 0))
    : null;
  const inImpact = (id: string) => series[id]!.win.filter((p) => p.t >= estStart && p.t <= impactEnd);
  const peakErrorRate = Math.max(0, ...inImpact("api-gateway").map((p) => p.errorRate), ...inImpact("edge-cdn").map((p) => p.errorRate));
  const peakP99 = origin ? Math.max(0, ...inImpact(origin).map((p) => p.p99)) : 0;
  const impactServices: Analysis["impact"]["services"] = clusterServices.map((id) => {
    const s = series[id]!;
    const baseErr = median(s.base.map((p) => p.errorRate));
    const baseP99 = median(s.base.map((p) => p.p99));
    const w = inImpact(id);
    return {
      id,
      role: id === origin ? "origin" : callers.includes(id) || shadowed.includes(id) ? "downstream" : "related",
      errorDelta: Math.max(0, Math.max(0, ...w.map((p) => p.errorRate)) - baseErr),
      latencyRatio: Math.max(1, ...w.map((p) => p.p99)) / Math.max(baseP99, 1e-6),
    };
  });
  const durationMs = Math.max(0, end - estStart);
  const users = Math.round(failed / 3.6);
  const impactSummary = !cluster.length
    ? "No measurable impact on platform telemetry was found in the analysis window."
    : failed < 250
      ? `User-facing request failures were minimal (about ${formatCompact(failed)}). Impact is mainly latency and delayed processing in ${list(clusterServices.slice(0, 3))} over ${formatDuration(durationMs, { short: true })}.`
      : `About ${formatCompact(failed)} requests failed at the edge over ${formatDuration(durationMs, { short: true })} (roughly ${formatCompact(users)} users). Gateway error rate peaked at ${formatPct(peakErrorRate)} against a ${formatPct(gw.baseErr)} baseline, using ${burnPct.toFixed(burnPct < 1 ? 2 : 1)}% of the 30-day error budget.`;

  /* contributing factors */
  const factors: string[] = [];
  if (change) factors.push(`Change: ${change.kind === "deploy" ? `${change.service} ${change.version ?? ""} deployed` : `${changeLabel(change.kind)} on ${change.service}`} by ${change.author} ${Math.round(changeLeadMin!)} min before onset ("${change.summary}").`);
  if (mode && cluster.length) factors.push(...mode.factors(facts));
  const gwRps = series["api-gateway"]!;
  const gwBaseline = median(gwRps.base.map((p) => p.rps));
  const gwPeak = Math.max(...gwRps.win.filter((p) => p.t >= estStart).map((p) => p.rps), 0);
  if (cluster.some((c) => c.metric === "errorRate") && gwPeak > gwBaseline * 1.08 && gwPeak < gwBaseline * 1.6) factors.push(`Retry amplification: gateway throughput rose ${Math.round((gwPeak / gwBaseline - 1) * 100)}% while error rates climbed.`);
  const concurrent = incidents.filter((i) => i.id !== incident.id && i.impactStartedAt < estStart && (!i.resolvedAt || i.resolvedAt > estStart));
  if (concurrent.length && !preExisting) factors.push(`Concurrent incident${concurrent.length > 1 ? "s" : ""} ${concurrent.map((c) => c.id).join(", ")} already degrading part of the platform at onset.`);
  if (!factors.length) factors.push("No contributing factors could be established from telemetry.");

  /* actions */
  let actions: RecommendedAction[];
  if (mode && (cluster.length || keywordMode)) {
    actions = facts.resolved ? [...mode.followUp(facts), { priority: "P1", action: `Watch ${METRIC_LABEL[facts.metric].toLowerCase()} on ${facts.origin} for 24h to confirm recovery holds`, rationale: "Make sure the mitigation was a fix, not a pause." }] : [...mode.immediate(facts), ...mode.followUp(facts)];
  } else if (origin) {
    actions = [
      { priority: "P0", action: `Inspect ${origin}: recent deploys, saturation and error logs since ${formatClock(estStart, false)}`, rationale: "It is the earliest anomalous component." },
      { priority: "P1", action: `Shed or shift load away from ${origin} if p99 keeps climbing`, rationale: "Limits blast radius while you diagnose." },
      { priority: "P2", action: "Capture thread and heap dumps for the postmortem", rationale: "There is no matching signature yet, so preserve the evidence." },
    ];
  } else {
    actions = [
      { priority: "P1", action: "Collect a customer-side reproduction (HAR, request IDs, timestamps)", rationale: "Sentinel saw no server-side signal. Correlation IDs will locate it." },
      { priority: "P1", action: `Check client and third-party dashboards for ${incident.affectedServices.join(", ") || "the reported flow"}`, rationale: "The failure may sit outside instrumented services." },
      { priority: "P2", action: "Add instrumentation for the affected path if it is not covered", rationale: "Closes the observability gap." },
    ];
  }

  /* prevention */
  const prevention = [...(mode?.prevention ?? ["Add an SLO and burn-rate alert for the affected user journey.", "Instrument the request path end to end with trace context."])];
  const detectionLag = incident.detectedAt - estStart;
  if (cluster.length && detectionLag > 90_000) prevention.push(`Detection lagged the first anomaly by ${formatDuration(detectionLag)}. Add a multi-window burn-rate alert on ${METRIC_LABEL[facts.metric].toLowerCase()} for ${facts.origin}.`);
  if (incident.acknowledgedAt && incident.acknowledgedAt - incident.detectedAt > 4 * MIN) prevention.push(`Acknowledgement took ${formatDuration(incident.acknowledgedAt - incident.detectedAt)}. Review the paging route for ${SERVICE_MAP[facts.origin]?.team ?? "the owning team"}.`);

  /* evidence */
  const top = origin ? (["edge-cdn", "api-gateway", ...callers].find((c) => clusterServices.includes(c) && c !== origin) ?? callers[0]) : undefined;
  let propagationPath: string[] = [];
  if (origin && top) propagationPath = callPath(top, origin) ?? [top, origin];
  else if (origin && shadowed.length) propagationPath = [origin, ...shadowed.slice(0, 3)];
  else if (origin) propagationPath = [origin];

  const related = incidents
    .filter((i) => i.id !== incident.id)
    .filter((i) => {
      const iEnd = i.resolvedAt ?? now;
      const overlap = i.impactStartedAt <= winEnd && iEnd >= winStart;
      const shared = i.affectedServices.some((s) => relevantSvcs.has(s)) || (origin ? i.affectedServices.includes(origin) : false);
      return overlap && shared;
    })
    .map((i) => i.id);

  /* executive summary */
  const sevPhrase = `${incident.severity} ${incident.id}`;
  const statusPhrase = facts.resolved ? `was resolved after ${formatDuration(durationMs, { short: true })}` : `is ongoing (${formatDuration(durationMs, { short: true })} since first signal)`;
  let summary: string;
  if (cluster.length && origin) {
    const lagTxt = !manual && detectionLag > 0 ? `, ${formatDuration(detectionLag)} before Sentinel opened the incident` : "";
    summary = `${sevPhrase} ${statusPhrase}. Sentinel correlated ${cluster.length} metric anomal${cluster.length === 1 ? "y" : "ies"} across ${clusterServices.length} service${clusterServices.length > 1 ? "s" : ""}. The first signal was ${METRIC_LABEL[facts.metric].toLowerCase()} on ${origin} at ${formatClock(estStart)} (${facts.ratio >= 1 ? `${facts.ratio.toFixed(1)}× baseline` : `${Math.round((1 - facts.ratio) * 100)}% below baseline`}, ${formatSigma(facts.z)})${lagTxt}${callers.length ? `. Symptoms then reached ${list(callers.slice(0, 3))}` : ""}.`;
    if (facts.topHit && mode && bestCount) summary += ` ${bestCount} log lines match the "${mode!.label.toLowerCase()}" signature, led by "${facts.topHit.label.toLowerCase()}" on ${facts.topHit.service}.`;
    if (change) summary += ` A correlated change landed ${Math.round(changeLeadMin!)} min earlier: ${change.summary}.`;
    summary += ` Most likely cause: ${rootCause.title.charAt(0).toLowerCase()}${rootCause.title.slice(1)} (${confidence}% confidence).`;
    if (preExisting && related.length) summary += ` The anomaly predates the reported start, so this report likely duplicates ${related[0]}.`;
  } else if (keywordMode) {
    summary = `${sevPhrase} ${statusPhrase}. Sentinel found no telemetry anomaly, log signature or change that corroborates the report. The text resembles "${mode!.label.toLowerCase()}", so treat this as a low-confidence starting point (${confidence}%) until there is more evidence.`;
  } else {
    summary = `${sevPhrase} ${statusPhrase}. Sentinel scanned ${SERVICES.length} services and ${formatCompact(logs.length)} log lines and found no anomaly that explains the report. The issue is likely outside instrumented services or below detection thresholds.`;
  }

  return {
    incidentId: incident.id,
    generatedAt: now,
    mode: "demo",
    engineVersion: ENGINE_VERSION,
    executiveSummary: summary,
    rootCause,
    confidence,
    signals,
    contributingFactors: factors.slice(0, 6),
    impact: {
      summary: impactSummary,
      durationMs,
      failedRequests: failed,
      usersAffected: users,
      errorBudgetBurnPct: burnPct,
      revenueAtRisk: revenue && revenue > 0 ? revenue : null,
      peakErrorRate,
      peakP99,
      services: impactServices,
    },
    anomalies: cluster.slice(0, 12).map(({ end: _e, active: _a, ...c }) => c),
    actions,
    prevention: prevention.slice(0, 6),
    evidence: {
      logSignatures: [...modeHits, ...otherHits].slice(0, 6).map(({ signatureId, label, service, count, sample, level }) => ({ signatureId, label, service, count, sample, level })),
      changes: change ? [change, ...changes.filter((c) => c !== change && relevantSvcs.has(c.service) && c.at <= estStart + MIN && c.at >= estStart - horizon).slice(0, 2)] : [],
      propagationPath,
      relatedIncidents: related,
      pointsAnalyzed: SERVICES.length * METRICS.length * (baseTimes.length + winTimes.length),
      logsAnalyzed: logs.length,
      servicesScanned: SERVICES.length,
    },
  };
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
