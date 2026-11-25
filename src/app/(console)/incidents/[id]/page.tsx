"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertOctagon,
  ArrowLeft,
  BellRing,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  FileText,
  Flag,
  GitBranch,
  LineChart,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Radar,
  ScrollText,
  SearchX,
  Send,
  UserCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { SERVICE_MAP } from "@/lib/catalog/services";
import { serviceHealth, statusTone, STATUS_LABEL as HEALTH_LABEL } from "@/lib/analytics/health";
import { sampleMetrics } from "@/lib/sim/telemetry";
import { STATUS_LABEL, STATUS_ORDER, useSentinel } from "@/lib/store";
import type { Incident, IncidentStatus, Severity, TimelineEvent } from "@/lib/types";
import { cn, formatClock, formatDateLong, formatDuration, formatMs, formatPct, timeAgo } from "@/lib/utils";
import { Page } from "@/components/ui/page";
import { Avatar, Badge, Button, EmptyState, Panel, PanelHeader, ServiceChip, SeverityBadge, Skeleton, StatusBadge, StatusIcon, TONE, Textarea, buttonClass } from "@/components/ui/primitives";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/overlays";
import { AnalysisPanel } from "@/components/incidents/analysis-panel";
import { LogsTab, PostmortemTab, TelemetryTab } from "@/components/incidents/incident-tabs";
import { ResolveDialog } from "@/components/incidents/incident-actions";

type Tab = "analysis" | "telemetry" | "logs" | "postmortem";

export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const incident = useSentinel((s) => s.incidents.find((i) => i.id === id));
  const ready = useSentinel((s) => s.hydrated);

  if (!ready) return <DetailSkeleton />;
  if (!incident)
    return (
      <Page>
        <Panel className="mt-6">
          <EmptyState
            icon={SearchX}
            title={`${decodeURIComponent(id)} doesn't exist`}
            body="It may have been removed when the demo data was reset."
            action={
              <Link href="/incidents" className={buttonClass({ variant: "secondary" })}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back to incidents
              </Link>
            }
            className="py-16"
          />
        </Panel>
      </Page>
    );
  return <IncidentDetail key={incident.id} incident={incident} />;
}

function IncidentDetail({ incident }: { incident: Incident }) {
  const now = useSentinel((s) => s.now);
  const analysis = useSentinel((s) => s.analyses[incident.id]);
  const [tab, setTab] = useState<Tab>("analysis");
  const [resolving, setResolving] = useState(false);
  const active = incident.status !== "resolved";

  const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: "analysis", label: "Root cause", icon: BrainCircuit },
    { id: "telemetry", label: "Telemetry", icon: LineChart },
    { id: "logs", label: "Logs", icon: ScrollText },
    { id: "postmortem", label: "Postmortem", icon: FileText },
  ];

  return (
    <Page>
      <Header incident={incident} now={now} onResolve={() => setResolving(true)} onPostmortem={() => setTab("postmortem")} />
      <StatusStepper incident={incident} onResolve={() => setResolving(true)} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className="flex gap-1 overflow-x-auto border-b border-hairline" role="tablist" aria-label="Incident sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn("relative flex h-10 shrink-0 items-center gap-2 px-3 text-[13px] transition", tab === t.id ? "text-ink" : "text-ink-subtle hover:text-ink-muted")}
              >
                <t.icon className={cn("h-3.5 w-3.5", tab === t.id && t.id === "analysis" && "text-intel-bright")} />
                {t.label}
                {t.id === "analysis" && analysis && <span className="tabular rounded-[4px] bg-intel/15 px-1 text-[10.5px] text-intel-bright">{analysis.confidence}%</span>}
                {tab === t.id && <motion.span layoutId="incident-tab" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-intel" />}
              </button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === "analysis" && <AnalysisPanel key={incident.id} incident={incident} />}
            {tab === "telemetry" && (
              <Panel>
                <TelemetryTab incident={incident} analysis={analysis} />
              </Panel>
            )}
            {tab === "logs" && (
              <Panel className="overflow-hidden">
                <LogsTab incident={incident} analysis={analysis} />
              </Panel>
            )}
            {tab === "postmortem" && (
              <Panel>
                <PostmortemTab incident={incident} analysis={analysis} onRunAnalysis={() => setTab("analysis")} />
              </Panel>
            )}
          </div>
        </div>
        <aside className="space-y-4">
          <TimelinePanel incident={incident} now={now} />
          <AffectedServices incident={incident} now={now} origin={analysis?.rootCause.service ?? null} />
          <Details incident={incident} />
        </aside>
      </div>
      {active && <ResolveDialog incident={incident} open={resolving} onOpenChange={setResolving} />}
    </Page>
  );
}

function Header({ incident: i, now, onResolve, onPostmortem }: { incident: Incident; now: number; onResolve: () => void; onPostmortem: () => void }) {
  const router = useRouter();
  const acknowledge = useSentinel((s) => s.acknowledge);
  const setStatus = useSentinel((s) => s.setStatus);
  const setSeverity = useSentinel((s) => s.setSeverity);
  const active = i.status !== "resolved";
  const duration = (i.resolvedAt ?? now) - i.impactStartedAt;
  const urgent = active && (i.severity === "SEV-1" || i.severity === "SEV-2");

  return (
    <div className="relative mb-4">
      {urgent && <div className="pointer-events-none absolute -left-10 -top-16 h-40 w-[480px] rounded-full blur-3xl" style={{ background: i.severity === "SEV-1" ? "rgb(244 63 94 / 0.10)" : "rgb(251 146 60 / 0.08)" }} />}
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={i.severity} pulse={urgent} />
            <StatusBadge status={i.status} />
            <span className="font-mono text-[12px] text-ink-subtle">{i.id}</span>
            {i.source === "manual" && <Badge>Declared manually</Badge>}
            {i.source === "simulation" && <Badge tone="info">Simulated</Badge>}
          </div>
          <h1 className="mt-2.5 max-w-4xl text-[22px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[25px]">{i.title}</h1>
          <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-ink-muted">{i.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-ink-muted">
            <span className="flex items-center gap-1.5" title={formatDateLong(i.detectedAt)}>
              <Radar className="h-3.5 w-3.5 text-ink-subtle" /> Detected {formatClock(i.detectedAt, false)} <span className="text-ink-subtle">({timeAgo(i.detectedAt, now)})</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-ink-subtle" />
              <span className="tabular">{formatDuration(duration, { seconds: active })}</span>
              <span className="text-ink-subtle">{active ? "and counting" : "total"}</span>
            </span>
            <span className="flex items-center gap-1.5">
              {i.commander ? (
                <>
                  <Avatar name={i.commander} className="h-5 w-5 text-[8.5px]" /> {i.commander}
                </>
              ) : (
                <span className="text-warning">No commander yet</span>
              )}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {i.status === "open" && (
            <Button
              variant="primary"
              onClick={() => {
                acknowledge(i.id);
                toast.success(`${i.id} acknowledged`, { description: "You're now the incident commander." });
              }}
            >
              <UserCheck className="h-3.5 w-3.5" /> Acknowledge
            </Button>
          )}
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="secondary">
                <StatusIcon status={i.status} /> {STATUS_LABEL[i.status]} <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownLabel>Change status</DropdownLabel>
              {STATUS_ORDER.map((s) => (
                <DropdownItem
                  key={s}
                  inset
                  checked={i.status === s}
                  onSelect={() => {
                    if (s === i.status) return;
                    if (s === "resolved") return onResolve();
                    setStatus(i.id, s);
                    toast.success(`${i.id} is now ${STATUS_LABEL[s].toLowerCase()}`, {
                      description: s === "monitoring" ? "Mitigation recorded. Watch telemetry recover on the Telemetry tab." : undefined,
                    });
                  }}
                >
                  <StatusIcon status={s} /> {STATUS_LABEL[s]}
                </DropdownItem>
              ))}
            </DropdownContent>
          </Dropdown>
          {i.status !== "resolved" && (
            <Button variant="secondary" onClick={onResolve}>
              <CheckCircle2 className="h-3.5 w-3.5 text-good" /> Resolve
            </Button>
          )}
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownTrigger>
            <DropdownContent className="w-56">
              <DropdownLabel>Severity</DropdownLabel>
              {(["SEV-1", "SEV-2", "SEV-3", "SEV-4"] as Severity[]).map((s) => (
                <DropdownItem
                  key={s}
                  inset
                  checked={i.severity === s}
                  onSelect={() => {
                    if (s === i.severity) return;
                    setSeverity(i.id, s);
                    toast.success(`Severity changed to ${s}`);
                  }}
                >
                  <span className={cn("h-2 w-2 rounded-full", TONE[s === "SEV-1" ? "critical" : s === "SEV-2" ? "serious" : s === "SEV-3" ? "warning" : "info"].dot)} /> {s}
                </DropdownItem>
              ))}
              <DropdownSeparator />
              <DropdownItem onSelect={onPostmortem}>
                <FileText className="h-3.5 w-3.5" /> Postmortem
              </DropdownItem>
              <DropdownItem onSelect={() => window.open(`/report/${i.id}`, "_blank")}>
                <FileText className="h-3.5 w-3.5" /> Printable report
              </DropdownItem>
              <DropdownItem onSelect={() => router.push(`/logs?incident=${i.id}`)}>
                <ScrollText className="h-3.5 w-3.5" /> Correlated logs
              </DropdownItem>
              <DropdownItem
                onSelect={() => {
                  navigator.clipboard?.writeText(location.href).catch(() => {});
                  toast.success("Link copied");
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy link
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}

function StatusStepper({ incident: i, onResolve }: { incident: Incident; onResolve: () => void }) {
  const setStatus = useSentinel((s) => s.setStatus);
  const idx = STATUS_ORDER.indexOf(i.status);
  return (
    <ol className="panel flex overflow-x-auto p-1" aria-label="Incident lifecycle">
      {STATUS_ORDER.map((s, n) => {
        const done = n < idx;
        const current = n === idx;
        return (
          <li key={s} className="min-w-[118px] flex-1">
            <button
              onClick={() => {
                if (current) return;
                if (s === "resolved") return onResolve();
                setStatus(i.id, s);
                toast.success(`${i.id} is now ${STATUS_LABEL[s].toLowerCase()}`);
              }}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex h-10 w-full items-center gap-2 rounded-[6px] px-3 text-left text-[12.5px] transition",
                current ? "bg-white/[0.06] text-ink ring-1 ring-hairline-strong" : done ? "text-ink-muted hover:bg-white/[0.03]" : "text-ink-faint hover:bg-white/[0.03] hover:text-ink-subtle"
              )}
            >
              <span
                className={cn(
                  "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-1",
                  done ? "bg-intel/20 text-intel-bright ring-intel/40" : current ? cn(TONE[statusToneFor(s)].bg, TONE[statusToneFor(s)].ring) : "ring-hairline-strong"
                )}
              >
                {done ? <Check className="h-2.5 w-2.5" /> : current ? <StatusIcon status={s} className="h-2.5 w-2.5" /> : n + 1}
              </span>
              {STATUS_LABEL[s]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

const statusToneFor = (s: IncidentStatus) => (s === "open" ? "critical" : s === "acknowledged" ? "serious" : s === "resolved" ? "good" : s === "monitoring" ? "info" : "warning");

const EVENT_ICON: Record<TimelineEvent["type"], LucideIcon> = {
  created: Flag,
  detected: Radar,
  alert: BellRing,
  acknowledged: UserCheck,
  status: Activity,
  severity: AlertOctagon,
  note: MessageSquare,
  action: Wrench,
  deploy: GitBranch,
  analysis: BrainCircuit,
  resolved: CheckCircle2,
};

function TimelinePanel({ incident, now }: { incident: Incident; now: number }) {
  const addNote = useSentinel((s) => s.addNote);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"note" | "action">("note");
  const events = [...incident.timeline].sort((a, b) => b.at - a.at);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    addNote(incident.id, text, kind);
    setText("");
    toast.success(kind === "note" ? "Note added to the timeline" : "Action logged on the timeline");
  };
  return (
    <Panel>
      <PanelHeader title="Timeline" description={`${incident.timeline.length} events`} icon={Megaphone} />
      <form onSubmit={submit} className="border-b border-hairline p-3">
        <Textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add an update for responders…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
          }}
          aria-label="Timeline update"
        />
        <div className="mt-2 flex items-center gap-2">
          <div className="flex gap-1 text-[11.5px]">
            {(["note", "action"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("rounded-[5px] px-2 py-1 transition", kind === k ? "bg-white/[0.07] text-ink" : "text-ink-subtle hover:text-ink-muted")}>
                {k === "note" ? "Note" : "Action taken"}
              </button>
            ))}
          </div>
          <Button type="submit" size="xs" variant="primary" className="ml-auto" disabled={!text.trim()}>
            <Send className="h-3 w-3" /> Post
          </Button>
        </div>
      </form>
      <ol className="max-h-[560px] overflow-y-auto px-3 py-2">
        {events.map((e, idx) => {
          const Icon = EVENT_ICON[e.type];
          const tone = e.type === "resolved" ? "good" : e.type === "detected" || e.type === "alert" ? "critical" : e.type === "analysis" ? "info" : "neutral";
          return (
            <li key={e.id} className="relative flex gap-3 py-2">
              {idx < events.length - 1 && <span className="absolute left-[11px] top-9 h-[calc(100%-24px)] w-px bg-hairline-strong" aria-hidden />}
              <span className={cn("relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1", e.type === "analysis" ? "bg-intel/15 ring-intel/35" : cn(TONE[tone].bg, TONE[tone].ring))}>
                <Icon className={cn("h-3 w-3", e.type === "analysis" ? "text-intel-bright" : TONE[tone].text)} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                  <span className="font-medium text-ink">{e.actor}</span>
                  <span className="tabular text-ink-subtle" title={formatDateLong(e.at)}>
                    {formatClock(e.at)} · {timeAgo(e.at, now)}
                  </span>
                </p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{e.message}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function AffectedServices({ incident, now, origin }: { incident: Incident; now: number; origin: string | null }) {
  const incidents = useSentinel((s) => s.incidents);
  const ids = useMemo(() => [...new Set([...(origin ? [origin] : []), ...incident.affectedServices])], [incident, origin]);
  return (
    <Panel>
      <PanelHeader title="Affected services" description="Live health right now" />
      {ids.length === 0 ? (
        <p className="px-4 py-4 text-[12.5px] text-ink-subtle">No services recorded. Edit by declaring services when you create an incident.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {ids.map((id) => {
            const svc = SERVICE_MAP[id];
            if (!svc) return null;
            const h = serviceHealth(svc, sampleMetrics(svc, now || Date.now(), incidents));
            const tone = statusTone(h.status);
            return (
              <li key={id}>
                <Link href={`/services?service=${id}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.02]">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE[tone].dot)} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-mono text-[12px] text-ink">
                      {id}
                      {id === origin && <span className="rounded-[3px] bg-intel/15 px-1 font-sans text-[10px] text-intel-bright">probable origin</span>}
                    </p>
                    <p className="tabular text-[11px] text-ink-subtle">
                      err {formatPct(h.metrics.errorRate)} · p99 {formatMs(h.metrics.p99)}
                    </p>
                  </div>
                  <span className={cn("text-[11px] font-medium", TONE[tone].text)}>{HEALTH_LABEL[h.status]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Details({ incident: i }: { incident: Incident }) {
  const rows: [string, React.ReactNode][] = [
    ["Source", i.source === "detector" ? "Sentinel anomaly detector" : i.source === "manual" ? "Declared by a responder" : "Simulation"],
    ["Impact started", formatDateLong(i.impactStartedAt)],
    ["Detected", formatDateLong(i.detectedAt)],
    ["Acknowledged", i.acknowledgedAt ? formatDateLong(i.acknowledgedAt) : "Not yet"],
    ["Mitigated", i.mitigatedAt ? formatDateLong(i.mitigatedAt) : "Not yet"],
    ["Resolved", i.resolvedAt ? formatDateLong(i.resolvedAt) : "Not yet"],
  ];
  return (
    <Panel>
      <PanelHeader title="Details" />
      <dl className="space-y-2.5 px-4 py-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-[12px]">
            <dt className="shrink-0 text-ink-subtle">{k}</dt>
            <dd className="text-right text-ink-muted">{v}</dd>
          </div>
        ))}
        {i.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {i.tags.map((t) => (
              <ServiceChip key={t} id={`#${t}`} />
            ))}
          </div>
        )}
      </dl>
    </Panel>
  );
}

function DetailSkeleton() {
  return (
    <Page>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-4 h-12 w-full" />
        <div className="grid gap-4 pt-2 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-[480px]" />
          <Skeleton className="h-[480px]" />
        </div>
      </div>
    </Page>
  );
}
