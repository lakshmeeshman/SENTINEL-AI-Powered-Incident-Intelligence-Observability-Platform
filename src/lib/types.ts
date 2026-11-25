/* Core domain types for Sentinel. */

export type ServiceKind = "edge" | "gateway" | "service" | "database" | "cache" | "queue" | "search";
export type ServiceTier = "critical" | "high" | "standard";

export interface ServiceBaseline {
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  /** percent, e.g. 0.08 = 0.08% */
  errorRate: number;
  cpu: number;
  mem: number;
}

export interface ServiceDef {
  id: string;
  name: string;
  kind: ServiceKind;
  tier: ServiceTier;
  team: string;
  runtime: string;
  version: string;
  region: string;
  replicas: number;
  description: string;
  /** services this one calls */
  dependencies: string[];
  baseline: ServiceBaseline;
  /** unit label for throughput */
  unit: string;
  slo: { availability: number; latencyP99: number };
  position: { x: number; y: number };
}

export type MetricKey = "rps" | "errorRate" | "p50" | "p95" | "p99" | "cpu" | "mem";

export interface MetricPoint {
  t: number;
  rps: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  cpu: number;
  mem: number;
}

export type Severity = "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";
export type IncidentStatus = "open" | "acknowledged" | "investigating" | "identified" | "monitoring" | "resolved";

export type TimelineEventType =
  | "created"
  | "detected"
  | "alert"
  | "acknowledged"
  | "status"
  | "severity"
  | "note"
  | "action"
  | "deploy"
  | "analysis"
  | "resolved";

export interface TimelineEvent {
  id: string;
  at: number;
  type: TimelineEventType;
  actor: string;
  message: string;
}

export type IncidentSource = "detector" | "manual" | "simulation";

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  description: string;
  affectedServices: string[];
  impactStartedAt: number;
  detectedAt: number;
  acknowledgedAt?: number;
  mitigatedAt?: number;
  resolvedAt?: number;
  commander?: string;
  source: IncidentSource;
  tags: string[];
  timeline: TimelineEvent[];
  resolutionNote?: string;
  /**
   * Simulation ground truth. Used ONLY by the telemetry & log generators to
   * shape the synthetic world. The intelligence engine never reads these fields:
   * it has to infer the failure mode from metrics, logs, topology and changes.
   */
  sim?: { scenarioId: string; magnitude: number };
}

export type ChangeKind = "deploy" | "config" | "flag" | "infra";

export interface ChangeEvent {
  id: string;
  at: number;
  service: string;
  kind: ChangeKind;
  version?: string;
  author: string;
  summary: string;
}

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface LogEntry {
  id: string;
  t: number;
  level: LogLevel;
  service: string;
  message: string;
  traceId: string;
  spanId: string;
  host: string;
  attrs: Record<string, string | number | boolean>;
  /** set when the generator emitted this line because of an incident */
  incidentId?: string;
}

export type FeedKind = "deploy" | "config" | "scale" | "alert" | "anomaly" | "incident" | "recovery" | "info";
export type Tone = "good" | "warning" | "serious" | "critical" | "info" | "neutral";

export interface FeedEvent {
  id: string;
  t: number;
  kind: FeedKind;
  tone: Tone;
  service?: string;
  message: string;
  href?: string;
}

export interface AppNotification {
  id: string;
  t: number;
  title: string;
  body: string;
  severity: Severity | "info";
  incidentId?: string;
  read: boolean;
}

export type TimeRange = "15m" | "1h" | "6h" | "24h";

export interface Settings {
  displayName: string;
  handle: string;
  tickMs: number;
  chaosMode: boolean;
  chaosEveryMin: number;
  toastSeverity: Severity;
  preferAi: boolean;
  reduceMotion: boolean;
  onboarded: boolean;
  sidebarCollapsed: boolean;
  defaultRange: TimeRange;
}

/* ───────────── Intelligence ───────────── */

export type AnalysisMode = "ai" | "demo";

export interface ConfidenceSignal {
  id: string;
  label: string;
  /** 0..1 contribution weight */
  weight: number;
  /** 0..1 strength of evidence */
  score: number;
  detail: string;
}

export interface CorrelatedAnomaly {
  service: string;
  metric: MetricKey;
  onset: number;
  /** seconds relative to impact start (negative = before) */
  offsetSec: number;
  peakZ: number;
  baseline: number;
  peak: number;
  ratio: number;
}

export interface LogSignatureHit {
  signatureId: string;
  label: string;
  service: string;
  count: number;
  sample: string;
  level: LogLevel;
}

export interface RecommendedAction {
  priority: "P0" | "P1" | "P2";
  action: string;
  rationale: string;
}

export interface ImpactAssessment {
  summary: string;
  durationMs: number;
  failedRequests: number;
  usersAffected: number;
  errorBudgetBurnPct: number;
  revenueAtRisk: number | null;
  peakErrorRate: number;
  peakP99: number;
  services: { id: string; role: "origin" | "downstream" | "related"; errorDelta: number; latencyRatio: number }[];
}

export interface Analysis {
  incidentId: string;
  generatedAt: number;
  mode: AnalysisMode;
  model?: string;
  engineVersion: string;
  executiveSummary: string;
  rootCause: {
    title: string;
    detail: string;
    service: string | null;
    category: string;
    failureMode: string | null;
  };
  confidence: number;
  signals: ConfidenceSignal[];
  contributingFactors: string[];
  impact: ImpactAssessment;
  anomalies: CorrelatedAnomaly[];
  actions: RecommendedAction[];
  prevention: string[];
  evidence: {
    logSignatures: LogSignatureHit[];
    changes: ChangeEvent[];
    propagationPath: string[];
    relatedIncidents: string[];
    pointsAnalyzed: number;
    logsAnalyzed: number;
    servicesScanned: number;
  };
  completedActions?: string[];
}
