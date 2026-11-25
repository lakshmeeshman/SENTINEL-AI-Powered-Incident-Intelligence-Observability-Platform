import type { Analysis, Incident, RecommendedAction } from "@/lib/types";

/*
 * Optional Claude layer. The deterministic engine measures the evidence (anomalies,
 * signatures, changes, impact). Claude writes the narrative from that evidence only;
 * measured numbers are never replaced by model output.
 */

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export interface AiNarrative {
  executiveSummary: string;
  rootCause: { title: string; detail: string };
  contributingFactors: string[];
  actions: RecommendedAction[];
  prevention: string[];
  impactSummary?: string;
}

export function buildPrompt(incident: Pick<Incident, "id" | "title" | "severity" | "status" | "description" | "affectedServices" | "timeline">, evidence: Analysis) {
  const system = `You are Sentinel, a senior site reliability engineer writing a root-cause analysis for an on-call team.
Use ONLY the evidence provided. Do not invent services, numbers, versions or people.
Be specific and concise: reference services, metrics, timings and changes from the evidence.
Respond with a single JSON object and nothing else, matching this TypeScript type:
{
  "executiveSummary": string,          // 3-5 sentences, plain English, for an engineering manager
  "rootCause": { "title": string, "detail": string },   // title under 70 chars
  "contributingFactors": string[],     // 3-5 items
  "actions": { "priority": "P0" | "P1" | "P2", "action": string, "rationale": string }[],  // 3-6 items, imperative
  "prevention": string[],              // 3-5 items
  "impactSummary": string              // 1-2 sentences using the measured impact numbers
}`;

  const payload = {
    incident: {
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      description: incident.description,
      reportedServices: incident.affectedServices,
      timeline: incident.timeline.slice(-12).map((e) => ({ at: new Date(e.at).toISOString(), type: e.type, actor: e.actor, message: e.message })),
    },
    measuredEvidence: {
      engineHypothesis: { ...evidence.rootCause, confidencePct: evidence.confidence },
      confidenceSignals: evidence.signals.map((s) => ({ signal: s.label, score: Number(s.score.toFixed(2)), detail: s.detail })),
      anomalies: evidence.anomalies.map((a) => ({
        service: a.service,
        metric: a.metric,
        onset: new Date(a.onset).toISOString(),
        secondsFromFirstSignal: a.offsetSec,
        peakVsBaseline: Number(a.ratio.toFixed(2)),
        zScore: Number(a.peakZ.toFixed(1)),
      })),
      logSignatures: evidence.evidence.logSignatures,
      correlatedChanges: evidence.evidence.changes.map((c) => ({ ...c, at: new Date(c.at).toISOString() })),
      propagationPath: evidence.evidence.propagationPath,
      relatedIncidents: evidence.evidence.relatedIncidents,
      impact: {
        failedRequests: evidence.impact.failedRequests,
        estimatedUsers: evidence.impact.usersAffected,
        errorBudgetBurnPct: Number(evidence.impact.errorBudgetBurnPct.toFixed(2)),
        revenueAtRiskUsd: evidence.impact.revenueAtRisk,
        peakGatewayErrorRatePct: Number(evidence.impact.peakErrorRate.toFixed(2)),
        durationMinutes: Math.round(evidence.impact.durationMs / 60000),
      },
    },
  };

  return { system, user: `Write the root-cause analysis for this incident.\n\n${JSON.stringify(payload, null, 2)}` };
}

export function parseNarrative(text: string): AiNarrative | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1));
    if (typeof j.executiveSummary !== "string" || !j.rootCause?.title) return null;
    const pr = (p: unknown): RecommendedAction["priority"] => (p === "P0" || p === "P1" || p === "P2" ? p : "P1");
    return {
      executiveSummary: String(j.executiveSummary),
      rootCause: { title: String(j.rootCause.title), detail: String(j.rootCause.detail ?? "") },
      contributingFactors: Array.isArray(j.contributingFactors) ? j.contributingFactors.map(String).slice(0, 6) : [],
      actions: Array.isArray(j.actions)
        ? j.actions.slice(0, 7).map((a: { priority?: unknown; action?: unknown; rationale?: unknown }) => ({ priority: pr(a.priority), action: String(a.action ?? ""), rationale: String(a.rationale ?? "") }))
        : [],
      prevention: Array.isArray(j.prevention) ? j.prevention.map(String).slice(0, 6) : [],
      impactSummary: typeof j.impactSummary === "string" ? j.impactSummary : undefined,
    };
  } catch {
    return null;
  }
}

/** merge AI narrative into the measured analysis; numbers always come from the engine */
export function mergeNarrative(base: Analysis, n: AiNarrative, model: string): Analysis {
  return {
    ...base,
    mode: "ai",
    model,
    executiveSummary: n.executiveSummary || base.executiveSummary,
    rootCause: { ...base.rootCause, title: n.rootCause.title || base.rootCause.title, detail: n.rootCause.detail || base.rootCause.detail },
    contributingFactors: n.contributingFactors.length ? n.contributingFactors : base.contributingFactors,
    actions: n.actions.length ? n.actions : base.actions,
    prevention: n.prevention.length ? n.prevention : base.prevention,
    impact: { ...base.impact, summary: n.impactSummary || base.impact.summary },
  };
}
