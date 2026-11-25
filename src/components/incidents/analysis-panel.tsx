"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  CircleDot,
  Cpu,
  FileSearch,
  GitBranch,
  Loader2,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { analyzeIncident } from "@/lib/intelligence/engine";
import { fetchAiStatus, runAnalysis, type AiStatus } from "@/lib/intelligence/client";
import { useSentinel } from "@/lib/store";
import { METRIC_LABEL } from "@/lib/sim/telemetry";
import type { Analysis, Incident } from "@/lib/types";
import { cn, formatClock, formatCompact, formatCurrency, formatDuration, formatMs, formatPct, formatSigma, timeAgo } from "@/lib/utils";
import { Badge, Button, ServiceChip } from "@/components/ui/primitives";
import { Tip } from "@/components/ui/overlays";

interface Step {
  icon: LucideIcon;
  label: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AnalysisPanel({ incident }: { incident: Incident }) {
  const analysis = useSentinel((s) => s.analyses[incident.id]);
  const incidents = useSentinel((s) => s.incidents);
  const changes = useSentinel((s) => s.changes);
  const preferAi = useSentinel((s) => s.settings.preferAi);
  const now = useSentinel((s) => s.now);
  const save = useSentinel((s) => s.saveAnalysis);
  const toggleAction = useSentinel((s) => s.toggleActionDone);
  const [phase, setPhase] = useState<"idle" | "running" | "done">(analysis ? "done" : "idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [fresh, setFresh] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    fetchAiStatus().then(setAi);
  }, []);

  const run = async () => {
    if (phase === "running") return;
    setPhase("running");
    setFresh(true);
    try {
    const at = Date.now();
    const st = useSentinel.getState();
    // the engine is fast; compute once up front so the progress steps can report real numbers
    const preview = analyzeIncident({ incident, incidents: st.incidents, changes: st.changes, now: at });
    const willUseAi = preferAi && (await fetchAiStatus()).enabled;
    const plan: Step[] = [
      { icon: Radar, label: `Collected ${formatCompact(preview.evidence.pointsAnalyzed)} metric points across ${preview.evidence.servicesScanned} services` },
      { icon: CircleDot, label: `Scored against a frozen pre-incident baseline: ${preview.anomalies.length} anomal${preview.anomalies.length === 1 ? "y" : "ies"} in the onset window` },
      { icon: FileSearch, label: `Classified ${formatCompact(preview.evidence.logsAnalyzed)} log lines: ${preview.evidence.logSignatures.reduce((a, h) => a + h.count, 0)} match known failure signatures` },
      { icon: Workflow, label: preview.rootCause.service ? `Traced the dependency graph to ${preview.rootCause.service}` : "Traced the dependency graph: no single origin" },
      { icon: GitBranch, label: preview.evidence.changes.length ? `Correlated ${preview.evidence.changes.length} change${preview.evidence.changes.length > 1 ? "s" : ""} inside the causal horizon` : "No deploys or config changes in the causal horizon" },
      { icon: willUseAi ? Sparkles : Cpu, label: willUseAi ? "Claude is writing the narrative from the measured evidence" : "Composing the analysis with demo intelligence" },
    ];
    setSteps(plan);
    setStepIdx(0);
    const resultP = willUseAi ? runAnalysis({ incident, incidents: st.incidents, changes: st.changes, now: at, preferAi }) : Promise.resolve({ analysis: preview, note: undefined as string | undefined });
    for (let i = 0; i < plan.length; i++) {
      await sleep(i === plan.length - 1 ? 520 : 300 + Math.random() * 260);
      setStepIdx(i + 1);
    }
    const { analysis: result, note } = await resultP;
    save(result);
    setPhase("done");
    if (note) toast("Used demo intelligence", { description: note });
    } catch (e) {
      console.error(e);
      setPhase(useSentinel.getState().analyses[incident.id] ? "done" : "idle");
      toast.error("Analysis failed", { description: "Sentinel couldn't complete the analysis. Try again in a few seconds." });
    }
  };

  useEffect(() => {
    if (!analysis && !autoRan.current) {
      const t = setTimeout(() => {
        autoRan.current = true;
        run();
      }, 350);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident.id]);

  const stale = analysis && incident.status !== "resolved" && now - analysis.generatedAt > 5 * 60_000;

  return (
    <section className="intel-border relative overflow-hidden rounded-[10px]" aria-label="Root cause analysis">
      <div className="pointer-events-none absolute -top-24 left-1/3 h-48 w-96 rounded-full bg-intel/10 blur-3xl" />
      <header className="relative flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-intel/15 ring-1 ring-intel/30">
          <BrainCircuit className="h-4 w-4 text-intel-bright" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold text-ink">Root cause analysis</h2>
          <p className="text-[11.5px] text-ink-subtle">
            {phase === "running" ? "Analysing evidence…" : analysis ? `Generated ${timeAgo(analysis.generatedAt, now || Date.now())} · ${analysis.engineVersion}` : "Not run yet"}
            {stale && <span className="text-warning"> · new telemetry since</span>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {analysis && phase !== "running" && <ModeBadge analysis={analysis} />}
          {phase !== "running" && (
            <Button variant={analysis ? "outline" : "primary"} size="sm" onClick={run}>
              <RefreshCw className="h-3.5 w-3.5" /> {analysis ? "Regenerate" : "Run analysis"}
            </Button>
          )}
        </div>
      </header>

      <div className="relative">
        <AnimatePresence mode="wait">
          {phase === "running" ? (
            <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-5 py-6">
              <div className="relative mb-5 h-px overflow-hidden bg-hairline">
                <span className="absolute inset-y-0 w-1/3 animate-scan bg-gradient-to-r from-transparent via-intel to-transparent" />
              </div>
              <ol className="space-y-3">
                {steps.map((s, i) => {
                  const done = i < stepIdx;
                  const current = i === stepIdx;
                  return (
                    <motion.li key={s.label} initial={{ opacity: 0, x: -6 }} animate={{ opacity: i <= stepIdx ? 1 : 0.35, x: 0 }} transition={{ delay: i * 0.04 }} className="flex items-center gap-3 text-[13px]">
                      <span className={cn("flex h-5 w-5 items-center justify-center rounded-full ring-1", done ? "bg-intel/20 ring-intel/40" : "ring-hairline-strong")}>
                        {done ? <Check className="h-3 w-3 text-intel-bright" /> : current ? <Loader2 className="h-3 w-3 animate-spin text-ink-muted" /> : <s.icon className="h-3 w-3 text-ink-faint" />}
                      </span>
                      <span className={done ? "text-ink" : "text-ink-muted"}>{s.label}</span>
                    </motion.li>
                  );
                })}
              </ol>
            </motion.div>
          ) : analysis ? (
            <motion.div key={`done-${analysis.generatedAt}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <AnalysisBody analysis={analysis} fresh={fresh} ai={ai} onToggle={(a) => toggleAction(incident.id, a)} />
            </motion.div>
          ) : (
            <motion.div key="idle" className="px-5 py-10 text-center">
              <p className="text-[13px] text-ink-muted">Sentinel will correlate metrics, logs, dependencies and recent changes for this incident.</p>
              <Button variant="primary" className="mt-4" onClick={run}>
                <BrainCircuit className="h-3.5 w-3.5" /> Run analysis
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function ModeBadge({ analysis }: { analysis: Analysis }) {
  return analysis.mode === "ai" ? (
    <Tip content="Narrative written by Claude from evidence Sentinel measured. Scores and numbers are computed, not generated.">
      <span className="inline-flex h-6 items-center gap-1.5 rounded-[5px] bg-intel/15 px-2 text-[11.5px] font-medium text-intel-bright ring-1 ring-inset ring-intel/35">
        <Sparkles className="h-3 w-3" /> AI-powered · {analysis.model}
      </span>
    </Tip>
  ) : (
    <Tip content="Produced by Sentinel's deterministic engine: statistical anomaly detection, log signature classification, dependency tracing and change correlation. Set ANTHROPIC_API_KEY for Claude-written narratives.">
      <span className="inline-flex h-6 items-center gap-1.5 rounded-[5px] bg-signal/10 px-2 text-[11.5px] font-medium text-signal ring-1 ring-inset ring-signal/30">
        <Cpu className="h-3 w-3" /> Demo intelligence
      </span>
    </Tip>
  );
}

function Typewriter({ text, active }: { text: string; active: boolean }) {
  const [n, setN] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active) {
      setN(text.length);
      return;
    }
    setN(0);
    const step = Math.max(2, Math.ceil(text.length / 90));
    const id = setInterval(() => setN((c) => (c >= text.length ? (clearInterval(id), c) : c + step)), 16);
    return () => clearInterval(id);
  }, [text, active]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="ml-px inline-block h-[1.1em] w-[2px] animate-blink bg-intel align-text-bottom" />}
    </>
  );
}

function Section({ title, icon: Icon, children, delay = 0, fresh, className }: { title: string; icon?: LucideIcon; children: React.ReactNode; delay?: number; fresh: boolean; className?: string }) {
  return (
    <motion.div initial={fresh ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: fresh ? delay : 0, duration: 0.35 }} className={className}>
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-muted">
        {Icon && <Icon className="h-3.5 w-3.5 text-intel-bright/80" />}
        {title}
      </h3>
      {children}
    </motion.div>
  );
}

function AnalysisBody({ analysis: a, fresh, ai, onToggle }: { analysis: Analysis; fresh: boolean; ai: AiStatus | null; onToggle: (action: string) => void }) {
  const done = new Set(a.completedActions ?? []);
  const maxOffset = Math.max(60, ...a.anomalies.map((x) => x.offsetSec)) * 1.15;
  const ringC = 2 * Math.PI * 26;
  const d = fresh ? 1.4 : 0;

  return (
    <div className="space-y-6 px-4 py-5 sm:px-5">
      <p className="text-[14.5px] leading-[1.65] text-ink">
        <Typewriter text={a.executiveSummary} active={fresh} />
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Section title="Probable root cause" icon={Target} delay={d} fresh={fresh}>
          <div className="rounded-[8px] border-l-2 border-intel bg-intel/[0.06] p-4 ring-1 ring-inset ring-intel/15">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{a.rootCause.title}</p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral">{a.rootCause.category}</Badge>
              {a.rootCause.service && <ServiceChip id={a.rootCause.service} />}
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">{a.rootCause.detail}</p>
          </div>
        </Section>
        <Section title="Confidence" icon={ShieldCheck} delay={d + 0.1} fresh={fresh}>
          <div className="rounded-[8px] bg-white/[0.02] p-4 ring-1 ring-hairline">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden>
                <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(148,163,196,0.1)" strokeWidth="6" />
                <motion.circle
                  cx="32"
                  cy="32"
                  r="26"
                  fill="none"
                  stroke="#8b7cf6"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={ringC}
                  initial={{ strokeDashoffset: ringC }}
                  animate={{ strokeDashoffset: ringC * (1 - a.confidence / 100) }}
                  transition={{ duration: 1, delay: fresh ? d + 0.2 : 0 }}
                />
              </svg>
              <div>
                <p className="tabular text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">{a.confidence}%</p>
                <p className="mt-1 text-[11.5px] text-ink-subtle">{a.confidence >= 80 ? "High" : a.confidence >= 55 ? "Moderate" : "Low"} confidence</p>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {a.signals.map((s) => (
                <li key={s.id}>
                  <Tip content={s.detail}>
                    <div className="cursor-default">
                      <div className="mb-1 flex justify-between text-[11.5px]">
                        <span className="text-ink-muted">{s.label}</span>
                        <span className="tabular text-ink-subtle">{Math.round(s.score * 100)}</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <motion.div className="h-full rounded-full bg-intel" initial={{ width: 0 }} animate={{ width: `${s.score * 100}%` }} transition={{ duration: 0.7, delay: fresh ? d + 0.3 : 0 }} />
                      </div>
                    </div>
                  </Tip>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Contributing factors" delay={d + 0.2} fresh={fresh}>
          <ul className="space-y-2">
            {a.contributingFactors.map((f, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-muted">
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-intel" />
                {f}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Impact assessment" delay={d + 0.25} fresh={fresh}>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] bg-hairline ring-1 ring-hairline">
            {[
              { l: "Failed requests", v: formatCompact(a.impact.failedRequests) },
              { l: "Users affected (est.)", v: formatCompact(a.impact.usersAffected) },
              { l: "Error budget used", v: `${a.impact.errorBudgetBurnPct.toFixed(a.impact.errorBudgetBurnPct < 1 ? 2 : 1)}%` },
              a.impact.revenueAtRisk ? { l: "Revenue at risk (est.)", v: formatCurrency(a.impact.revenueAtRisk) } : { l: "Peak edge error rate", v: formatPct(a.impact.peakErrorRate) },
              { l: "Duration", v: formatDuration(a.impact.durationMs, { short: true }) },
              { l: "Origin p99 peak", v: a.impact.peakP99 ? formatMs(a.impact.peakP99) : "—" },
            ].map((x) => (
              <div key={x.l} className="bg-panel px-3 py-2.5">
                <p className="text-[11px] text-ink-subtle">{x.l}</p>
                <p className="tabular mt-0.5 text-[15px] font-semibold text-ink">{x.v}</p>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">{a.impact.summary}</p>
        </Section>
      </div>

      {a.anomalies.length > 0 && (
        <Section title="Correlated anomalies, in order of onset" icon={Radar} delay={d + 0.3} fresh={fresh}>
          <div className="overflow-hidden rounded-[8px] ring-1 ring-hairline">
            <div className="hidden grid-cols-[170px_100px_minmax(0,1fr)_120px] gap-3 border-b border-hairline bg-white/[0.015] px-3 py-1.5 text-[11px] text-ink-subtle md:grid">
              <span>Service</span>
              <span>Metric</span>
              <span>Onset after first signal</span>
              <span className="text-right">Peak</span>
            </div>
            <ul className="divide-y divide-hairline">
              {a.anomalies.map((x, i) => (
                <motion.li
                  key={`${x.service}-${x.metric}`}
                  initial={fresh ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={{ delay: fresh ? d + 0.35 + i * 0.05 : 0 }}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 md:grid-cols-[170px_100px_minmax(0,1fr)_120px]"
                >
                  <span className={cn("truncate font-mono text-[12px]", x.service === a.rootCause.service ? "text-intel-bright" : "text-ink")}>{x.service}</span>
                  <span className="text-[12px] text-ink-muted md:order-none">{METRIC_LABEL[x.metric]}</span>
                  <div className="col-span-2 flex items-center gap-2 md:col-span-1">
                    <div className="relative h-1.5 flex-1 rounded-full bg-white/[0.04]">
                      <motion.div
                        className={cn("absolute inset-y-0 right-0 rounded-full", x.service === a.rootCause.service ? "bg-intel" : "bg-signal/60")}
                        initial={{ left: "100%" }}
                        animate={{ left: `${(Math.max(0, x.offsetSec) / maxOffset) * 100}%` }}
                        transition={{ duration: 0.6, delay: fresh ? d + 0.4 + i * 0.05 : 0 }}
                      />
                    </div>
                    <span className="tabular w-14 text-right font-mono text-[11px] text-ink-subtle">T+{x.offsetSec}s</span>
                  </div>
                  <span className="tabular col-span-2 text-[12px] text-ink-muted md:col-span-1 md:text-right">
                    {x.ratio >= 1 ? `${x.ratio >= 10 ? x.ratio.toFixed(0) : x.ratio.toFixed(1)}×` : `−${Math.round((1 - x.ratio) * 100)}%`} <span className="text-ink-subtle">· {formatSigma(x.peakZ)}</span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>
          {a.evidence.propagationPath.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-subtle">
              <span className="mr-1">Propagation path</span>
              {a.evidence.propagationPath.map((s, i) => (
                <span key={s} className="flex items-center gap-1.5">
                  <ServiceChip id={s} className={s === a.rootCause.service ? "text-intel-bright ring-intel/40" : undefined} />
                  {i < a.evidence.propagationPath.length - 1 && <ArrowRight className="h-3 w-3 text-ink-faint" />}
                </span>
              ))}
            </div>
          )}
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Recommended actions" delay={d + 0.4} fresh={fresh}>
          <ul className="space-y-1.5">
            {a.actions.map((x) => {
              const isDone = done.has(x.action);
              return (
                <li key={x.action}>
                  <button
                    onClick={() => {
                      onToggle(x.action);
                      if (!isDone) toast.success("Action marked complete", { description: "Added to the incident timeline." });
                    }}
                    className={cn("flex w-full gap-3 rounded-[7px] p-2.5 text-left ring-1 ring-hairline transition hover:bg-white/[0.025]", isDone && "opacity-60")}
                  >
                    <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] ring-1", isDone ? "bg-good/20 ring-good/40" : "ring-hairline-strong")}>
                      {isDone && <Check className="h-3 w-3 text-good" />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-start gap-2">
                        <span className={cn("mt-px shrink-0 rounded-[3px] px-1 font-mono text-[10px] font-semibold", x.priority === "P0" ? "bg-critical/15 text-[#ff8da0]" : x.priority === "P1" ? "bg-warning/12 text-warning" : "bg-white/[0.06] text-ink-muted")}>
                          {x.priority}
                        </span>
                        <span className={cn("text-[13px] font-medium text-ink", isDone && "line-through decoration-ink-subtle")}>{x.action}</span>
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-ink-subtle">{x.rationale}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
        <Section title="Prevention strategy" delay={d + 0.45} fresh={fresh}>
          <ul className="space-y-2">
            {a.prevention.map((p, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-muted">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good/80" />
                {p}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Evidence" icon={FileSearch} delay={d + 0.5} fresh={fresh}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-[8px] ring-1 ring-hairline">
            <p className="border-b border-hairline bg-white/[0.015] px-3 py-1.5 text-[11px] text-ink-subtle">Matched log signatures</p>
            {a.evidence.logSignatures.length === 0 ? (
              <p className="px-3 py-3 text-[12.5px] text-ink-subtle">No known failure signatures in the window.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {a.evidence.logSignatures.map((h) => (
                  <li key={`${h.signatureId}-${h.service}`} className="px-3 py-2">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="font-medium text-ink">{h.label}</span>
                      <span className="font-mono text-[11px] text-signal/80">{h.service}</span>
                      <span className="tabular ml-auto text-ink-muted">{h.count}×</span>
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-ink-subtle" title={h.sample}>
                      {h.sample}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-3">
            <div className="overflow-hidden rounded-[8px] ring-1 ring-hairline">
              <p className="border-b border-hairline bg-white/[0.015] px-3 py-1.5 text-[11px] text-ink-subtle">Correlated changes</p>
              {a.evidence.changes.length === 0 ? (
                <p className="px-3 py-3 text-[12.5px] text-ink-subtle">None inside the causal horizon.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {a.evidence.changes.map((c) => (
                    <li key={c.id} className="px-3 py-2 text-[12px]">
                      <p className="text-ink">
                        <span className="font-mono text-[11px] text-signal/80">{c.service}</span> {c.version && <span className="font-mono text-[11px] text-ink-muted">{c.version}</span>}
                      </p>
                      <p className="mt-0.5 text-ink-muted">{c.summary}</p>
                      <p className="mt-0.5 text-[11px] text-ink-subtle">
                        {c.kind} by {c.author} at {formatClock(c.at, false)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {a.evidence.relatedIncidents.length > 0 && (
              <p className="text-[12px] text-ink-muted">
                Overlapping incidents:{" "}
                {a.evidence.relatedIncidents.map((r, i) => (
                  <span key={r}>
                    <a href={`/incidents/${r}`} className="font-mono text-intel-bright hover:underline">
                      {r}
                    </a>
                    {i < a.evidence.relatedIncidents.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      </Section>

      {a.mode === "demo" && ai && !ai.enabled && (
        <p className="flex items-start gap-2 rounded-[7px] bg-white/[0.02] px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-subtle ring-1 ring-hairline">
          <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Demo intelligence: every number above is measured from telemetry, logs and change history by Sentinel&apos;s deterministic engine. Set ANTHROPIC_API_KEY on the server to have Claude write the narrative on top of the same evidence.
        </p>
      )}
    </div>
  );
}

export function useAnalysisFor(incident: Incident | undefined) {
  const analysis = useSentinel((s) => (incident ? s.analyses[incident.id] : undefined));
  return useMemo(() => analysis, [analysis]);
}
