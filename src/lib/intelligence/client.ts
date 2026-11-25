"use client";

import type { Analysis, ChangeEvent, Incident } from "@/lib/types";
import { analyzeIncident } from "./engine";
import { mergeNarrative, type AiNarrative } from "./ai";

export interface AiStatus {
  enabled: boolean;
  model: string | null;
  reachable: boolean;
}

let statusCache: Promise<AiStatus> | null = null;

export function fetchAiStatus(force = false): Promise<AiStatus> {
  if (!statusCache || force) {
    statusCache = fetch("/api/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { ai: { enabled: boolean; model: string | null } }) => ({ enabled: j.ai.enabled, model: j.ai.model, reachable: true }))
      .catch(() => ({ enabled: false, model: null, reachable: false }));
  }
  return statusCache;
}

export interface RunOptions {
  incident: Incident;
  incidents: Incident[];
  changes: ChangeEvent[];
  now: number;
  preferAi: boolean;
}

/** Always produces an analysis. Claude upgrades the narrative when configured. */
export async function runAnalysis(opts: RunOptions): Promise<{ analysis: Analysis; note?: string }> {
  const base = analyzeIncident(opts);
  if (!opts.preferAi) return { analysis: base };
  const status = await fetchAiStatus();
  if (!status.enabled) return { analysis: base };
  try {
    const { sim: _sim, ...incident } = opts.incident;
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ incident, evidence: base }),
    });
    const j = (await res.json()) as { mode: "ai" | "demo"; model?: string; narrative?: AiNarrative; reason?: string };
    if (j.mode === "ai" && j.narrative) return { analysis: mergeNarrative(base, j.narrative, j.model ?? "claude") };
    return { analysis: base, note: j.reason };
  } catch {
    return { analysis: base, note: "AI endpoint unreachable, used demo intelligence" };
  }
}
