import { SERVICE_MAP, ownerFor } from "@/lib/catalog/services";
import { METRIC_LABEL } from "@/lib/sim/telemetry";
import type { Analysis, Incident, RecommendedAction, Severity } from "@/lib/types";
import { formatCompact, formatCurrency, formatDateLong, formatDuration, formatPct, formatSigma } from "@/lib/utils";

export interface PostmortemTimelineItem {
  at: number;
  label: string;
  actor?: string;
  kind: "change" | "signal" | "response" | "resolution";
}

export interface ActionItem extends RecommendedAction {
  owner: string;
  due: number;
}

export interface Postmortem {
  incidentId: string;
  title: string;
  severity: Severity;
  status: Incident["status"];
  draft: boolean;
  generatedAt: number;
  analysisMode: Analysis["mode"];
  model?: string;
  meta: { label: string; value: string }[];
  executiveSummary: string;
  timeline: PostmortemTimelineItem[];
  rootCause: { title: string; detail: string; category: string; confidence: number; factors: string[] };
  impact: { summary: string; rows: { label: string; value: string }[] };
  resolution: string;
  wentWell: string[];
  wentWrong: string[];
  actionItems: ActionItem[];
}

export const MTTR_TARGET_MIN: Record<Severity, number> = { "SEV-1": 30, "SEV-2": 60, "SEV-3": 240, "SEV-4": 1440 };
const DAY = 86_400_000;

export function buildPostmortem(incident: Incident, analysis: Analysis, now: number): Postmortem {
  const firstSignal = incident.impactStartedAt <= incident.detectedAt ? Math.min(incident.detectedAt, analysis.anomalies[0]?.onset ?? incident.impactStartedAt) : incident.impactStartedAt;
  const end = incident.resolvedAt ?? now;
  const duration = end - firstSignal;
  const detectLag = incident.detectedAt - firstSignal;
  const ackLag = incident.acknowledgedAt ? incident.acknowledgedAt - incident.detectedAt : null;
  const resolved = incident.status === "resolved";
  const change = analysis.evidence.changes[0];
  const origin = analysis.rootCause.service;

  const timeline: PostmortemTimelineItem[] = [];
  for (const c of analysis.evidence.changes.slice(0, 2)) {
    timeline.push({ at: c.at, kind: "change", actor: c.author, label: `${c.kind === "deploy" ? `Deployed ${c.service} ${c.version ?? ""}` : `${c.kind} change on ${c.service}`}: ${c.summary}` });
  }
  const seen = new Set<string>();
  for (const a of analysis.anomalies) {
    const k = a.service;
    if (seen.has(k) || seen.size >= 4) continue;
    seen.add(k);
    timeline.push({ at: a.onset, kind: "signal", actor: "Sentinel", label: `${METRIC_LABEL[a.metric]} anomaly on ${a.service} (${a.ratio >= 1 ? `${a.ratio.toFixed(1)}×` : `−${Math.round((1 - a.ratio) * 100)}%`} baseline, ${formatSigma(a.peakZ)})` });
  }
  for (const e of incident.timeline) {
    timeline.push({ at: e.at, actor: e.actor, kind: e.type === "resolved" ? "resolution" : "response", label: e.message });
  }
  timeline.sort((a, b) => a.at - b.at);

  const wentWell: string[] = [];
  const wentWrong: string[] = [];
  const target = MTTR_TARGET_MIN[incident.severity];
  if (incident.source !== "manual" && detectLag <= 120_000) wentWell.push(`Automated detection opened the incident ${formatDuration(Math.max(0, detectLag))} after the first anomaly, before customer reports arrived.`);
  if (ackLag !== null && ackLag <= 5 * 60_000) wentWell.push(`On-call acknowledged within ${formatDuration(ackLag)}.`);
  if (change && resolved) wentWell.push(`Correlating ${change.kind === "deploy" ? `the ${change.service} ${change.version ?? ""} deploy` : "the recent change"} with the onset shortened diagnosis.`);
  if (resolved && duration <= target * 60_000) wentWell.push(`Resolved in ${formatDuration(duration, { short: true })}, within the ${incident.severity} target of ${formatDuration(target * 60_000, { short: true })}.`);
  if (analysis.impact.services.length > 0 && analysis.impact.services.length <= 3) wentWell.push(`Blast radius stayed within ${analysis.impact.services.length} service${analysis.impact.services.length > 1 ? "s" : ""}.`);
  if (incident.timeline.length >= 6) wentWell.push(`The timeline was kept current throughout the response (${incident.timeline.length} entries).`);
  if (!wentWell.length) wentWell.push("The response followed the standard incident process.");

  if (detectLag > 120_000 && incident.source !== "manual") wentWrong.push(`Detection lagged the first anomaly by ${formatDuration(detectLag)}.`);
  if (incident.source === "manual" && analysis.anomalies.length) wentWrong.push("The incident was reported manually, though telemetry showed anomalies first. Alerting did not page.");
  if (ackLag !== null && ackLag > 5 * 60_000) wentWrong.push(`Acknowledgement took ${formatDuration(ackLag)}.`);
  if (duration > target * 60_000) wentWrong.push(`${resolved ? "Resolution" : "The incident has run"} ${formatDuration(duration, { short: true })}, beyond the ${incident.severity} target of ${formatDuration(target * 60_000, { short: true })}.`);
  if (analysis.impact.services.length > 4) wentWrong.push(`The failure propagated to ${analysis.impact.services.length} services${analysis.evidence.propagationPath.length > 1 ? ` via ${analysis.evidence.propagationPath.join(" → ")}` : ""}.`);
  if (change?.kind === "deploy") wentWrong.push(`${change.service} ${change.version ?? ""} reached full traffic without a canary hold.`);
  if (change && change.kind !== "deploy") wentWrong.push(`A ${change.kind} change shipped without staged rollout or automated validation.`);
  if (analysis.impact.failedRequests > 50_000) wentWrong.push(`About ${formatCompact(analysis.impact.failedRequests)} failed requests reached customers before mitigation.`);
  if (!wentWrong.length) wentWrong.push("No significant process gaps were identified.");

  const owner = origin ? ownerFor(origin) : incident.commander ?? "Unassigned";
  const dueFor = (p: RecommendedAction["priority"]) => now + (p === "P0" ? 2 : p === "P1" ? 7 : 21) * DAY;
  const items: ActionItem[] = [];
  const pushItem = (a: RecommendedAction) => {
    if (items.some((i) => i.action === a.action)) return;
    items.push({ ...a, owner, due: dueFor(a.priority) });
  };
  for (const a of analysis.actions) if (resolved ? a.priority !== "P0" : true) pushItem(a);
  for (const p of analysis.prevention.slice(0, 3)) pushItem({ priority: "P2", action: p, rationale: "Prevention" });

  const lastAction = [...incident.timeline].reverse().find((e) => e.type === "action" || e.type === "resolved");
  const resolution = resolved
    ? [incident.resolutionNote, lastAction && lastAction.message !== incident.resolutionNote ? lastAction.message : undefined].filter(Boolean).join(" ") || "Resolved. No resolution note was recorded."
    : `Still active (status: ${incident.status}). ${lastAction ? `Latest action: ${lastAction.message}` : "Mitigation has not started."}`;

  const impactRows = [
    { label: "Duration", value: formatDuration(duration, { short: true }) },
    { label: "Failed requests", value: formatCompact(analysis.impact.failedRequests) },
    { label: "Users affected (est.)", value: formatCompact(analysis.impact.usersAffected) },
    { label: "Error budget consumed", value: `${analysis.impact.errorBudgetBurnPct.toFixed(analysis.impact.errorBudgetBurnPct < 1 ? 2 : 1)}% of 30 days` },
    { label: "Peak gateway error rate", value: formatPct(analysis.impact.peakErrorRate) },
    { label: "Services affected", value: String(analysis.impact.services.length) },
  ];
  if (analysis.impact.revenueAtRisk) impactRows.splice(3, 0, { label: "Revenue at risk (est.)", value: formatCurrency(analysis.impact.revenueAtRisk) });

  return {
    incidentId: incident.id,
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
    draft: !resolved,
    generatedAt: now,
    analysisMode: analysis.mode,
    model: analysis.model,
    meta: [
      { label: "Severity", value: incident.severity },
      { label: "Status", value: incident.status[0]!.toUpperCase() + incident.status.slice(1) },
      { label: "Incident commander", value: incident.commander ?? "Unassigned" },
      { label: "First signal", value: formatDateLong(firstSignal) },
      { label: "Detected", value: formatDateLong(incident.detectedAt) },
      { label: resolved ? "Resolved" : "Last updated", value: formatDateLong(end) },
      { label: "Services", value: (analysis.impact.services.length ? analysis.impact.services.map((s) => s.id) : incident.affectedServices).join(", ") || "None recorded" },
      { label: "Owning team", value: origin ? SERVICE_MAP[origin]?.team ?? "—" : "—" },
    ],
    executiveSummary: analysis.executiveSummary,
    timeline,
    rootCause: { title: analysis.rootCause.title, detail: analysis.rootCause.detail, category: analysis.rootCause.category, confidence: analysis.confidence, factors: analysis.contributingFactors },
    impact: { summary: analysis.impact.summary, rows: impactRows },
    resolution,
    wentWell,
    wentWrong,
    actionItems: items.slice(0, 8),
  };
}

const t = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/\|/g, "\\|");

export function postmortemMarkdown(pm: Postmortem): string {
  const lines: string[] = [];
  lines.push(`# Postmortem: ${pm.incidentId} — ${pm.title}`);
  lines.push("");
  if (pm.draft) lines.push("> **Draft.** This incident is still active. Sections will change as the response continues.\n");
  lines.push(`_Generated by Sentinel on ${t(pm.generatedAt)} · Analysis: ${pm.analysisMode === "ai" ? `Claude (${pm.model})` : "Sentinel demo intelligence (deterministic engine)"}_`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  for (const m of pm.meta) lines.push(`| ${m.label} | ${esc(m.value)} |`);
  lines.push("");
  lines.push("## Executive summary");
  lines.push("");
  lines.push(pm.executiveSummary);
  lines.push("");
  lines.push("## Incident timeline");
  lines.push("");
  lines.push("| Time (UTC) | Event | Actor |");
  lines.push("| --- | --- | --- |");
  for (const e of pm.timeline) lines.push(`| ${t(e.at)} | ${esc(e.label)} | ${esc(e.actor ?? "")} |`);
  lines.push("");
  lines.push("## Root cause");
  lines.push("");
  lines.push(`**${pm.rootCause.title}** (${pm.rootCause.category}, ${pm.rootCause.confidence}% confidence)`);
  lines.push("");
  lines.push(pm.rootCause.detail);
  lines.push("");
  lines.push("### Contributing factors");
  lines.push("");
  for (const f of pm.rootCause.factors) lines.push(`- ${f}`);
  lines.push("");
  lines.push("## Business impact");
  lines.push("");
  lines.push(pm.impact.summary);
  lines.push("");
  lines.push("| Measure | Value |");
  lines.push("| --- | --- |");
  for (const r of pm.impact.rows) lines.push(`| ${r.label} | ${r.value} |`);
  lines.push("");
  lines.push("## Resolution");
  lines.push("");
  lines.push(pm.resolution);
  lines.push("");
  lines.push("## What went well");
  lines.push("");
  for (const w of pm.wentWell) lines.push(`- ${w}`);
  lines.push("");
  lines.push("## What went wrong");
  lines.push("");
  for (const w of pm.wentWrong) lines.push(`- ${w}`);
  lines.push("");
  lines.push("## Action items");
  lines.push("");
  lines.push("| Priority | Action | Owner | Due |");
  lines.push("| --- | --- | --- | --- |");
  for (const a of pm.actionItems) lines.push(`| ${a.priority} | ${esc(a.action)} | ${a.owner} | ${d(a.due)} |`);
  lines.push("");
  lines.push("---");
  lines.push("_This is a blameless postmortem. It focuses on systems and process, not individuals._");
  return lines.join("\n");
}
