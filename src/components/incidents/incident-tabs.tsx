"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ClipboardCopy, Download, ExternalLink, FileText, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { SERVICE_MAP } from "@/lib/catalog/services";
import { useSentinel } from "@/lib/store";
import { generateLogs } from "@/lib/sim/logs";
import { serviceSeries } from "@/lib/sim/telemetry";
import { analysisIsStale, buildPostmortem, postmortemMarkdown } from "@/lib/postmortem";
import { analyzeIncident } from "@/lib/intelligence/engine";
import type { Analysis, Incident } from "@/lib/types";
import { downloadText, formatCompact, formatMs, formatPct } from "@/lib/utils";
import { Button, EmptyState, Segmented, ServiceChip, SEV_HEX, buttonClass } from "@/components/ui/primitives";
import { CHART, Legend, TimeSeriesChart, type Marker } from "@/components/charts/charts";
import { LogRow } from "@/components/logs/log-row";
import { PostmortemView } from "./postmortem-view";

const MIN = 60_000;

function windowFor(incident: Incident, now: number) {
  const from = incident.impactStartedAt - 30 * MIN;
  const to = Math.min(now, (incident.resolvedAt ?? now) + 12 * MIN);
  const span = to - from;
  const step = Math.max(5_000, Math.round(span / 200 / 5_000) * 5_000);
  return { from, to, step };
}

export function incidentMarkers(i: Incident): Marker[] {
  const m: Marker[] = [{ t: i.detectedAt, label: "detected", color: SEV_HEX[i.severity] }];
  if (i.acknowledgedAt) m.push({ t: i.acknowledgedAt, label: "ack", color: "#949cb0" });
  if (i.mitigatedAt) m.push({ t: i.mitigatedAt, label: "mitigated", color: "#60a5fa" });
  if (i.resolvedAt) m.push({ t: i.resolvedAt, label: "resolved", color: "#34d399" });
  return m;
}

export function TelemetryTab({ incident, analysis }: { incident: Incident; analysis?: Analysis }) {
  const incidents = useSentinel((s) => s.incidents);
  const now = useSentinel((s) => s.now);
  const candidates = useMemo(() => {
    const set = new Set<string>([...(analysis?.rootCause.service ? [analysis.rootCause.service] : []), ...incident.affectedServices, ...(analysis?.impact.services.map((s) => s.id) ?? [])]);
    if (!set.size) set.add("api-gateway");
    return [...set].slice(0, 8);
  }, [incident, analysis]);
  const [svc, setSvc] = useState(candidates[0]!);
  const active = candidates.includes(svc) ? svc : candidates[0]!;

  const data = useMemo(() => {
    const { from, to, step } = windowFor(incident, now);
    const times: number[] = [];
    for (let t = Math.floor(from / step) * step; t <= to; t += step) times.push(t);
    return serviceSeries(active, times, incidents);
  }, [incident, now, active, incidents]);

  const band = [{ x1: incident.impactStartedAt, x2: incident.resolvedAt ?? now, color: "#8b7cf6" }];
  const markers = incidentMarkers(incident);
  const svcDef = SERVICE_MAP[active]!;
  const last = data[data.length - 1];

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-ink-subtle">Service</span>
        {candidates.map((c) => (
          <button
            key={c}
            onClick={() => setSvc(c)}
            aria-pressed={c === active}
            className={`h-7 rounded-[6px] px-2.5 font-mono text-[11.5px] ring-1 ring-inset transition ${c === active ? "bg-signal/10 text-signal ring-signal/35" : "text-ink-subtle ring-hairline-strong hover:text-ink-muted"}`}
          >
            {c}
            {c === analysis?.rootCause.service && <span className="ml-1.5 font-sans text-[10px] text-intel-bright">origin</span>}
          </button>
        ))}
        <Legend className="ml-auto" items={[{ label: "Incident window", color: "#8b7cf6" }]} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { title: "Error rate", key: "errorRate", fmt: (v: number) => formatPct(v), now: last && formatPct(last.errorRate) },
          { title: "p99 latency", key: "p99", fmt: (v: number) => formatMs(v), now: last && formatMs(last.p99), base: svcDef.baseline.p99 },
          { title: `Throughput (${svcDef.unit})`, key: "rps", fmt: (v: number) => formatCompact(v), now: last && formatCompact(last.rps) },
          { title: "CPU and memory", key: "cpu", fmt: (v: number) => `${v.toFixed(0)}%`, now: last && `${last.cpu.toFixed(0)}% / ${last.mem.toFixed(0)}%` },
        ].map((c) => (
          <div key={c.title} className="rounded-[8px] ring-1 ring-hairline">
            <div className="flex items-center justify-between px-3 pt-2.5">
              <p className="text-[12.5px] font-medium text-ink">{c.title}</p>
              <p className="tabular text-[12px] text-ink-muted">{c.now}</p>
            </div>
            <TimeSeriesChart
              data={data.map((p) => ({ t: p.t, v: p[c.key as "rps"], mem: p.mem }))}
              height={170}
              animateKey={active}
              format={c.fmt}
              yDomain={c.key === "cpu" ? [0, 100] : c.key === "rps" ? [(m: number) => Math.floor(m * 0.7), "auto"] : undefined}
              bands={band}
              markers={markers}
              syncId="incident"
              series={
                c.key === "cpu"
                  ? [
                      { key: "v", label: "CPU", color: CHART.signal, type: "line" },
                      { key: "mem", label: "Memory", color: CHART.signalBright, type: "line", dashed: true },
                    ]
                  : [{ key: "v", label: c.title, color: CHART.signal, type: "area" }]
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function LogsTab({ incident, analysis }: { incident: Incident; analysis?: Analysis }) {
  const incidents = useSentinel((s) => s.incidents);
  const now = useSentinel((s) => s.now);
  const [level, setLevel] = useState<"problems" | "all">("problems");
  const services = useMemo(() => new Set([...incident.affectedServices, ...(analysis?.impact.services.map((s) => s.id) ?? []), ...(analysis?.rootCause.service ? [analysis.rootCause.service] : [])]), [incident, analysis]);
  const from = incident.impactStartedAt - 5 * MIN;
  const to = Math.min(now, (incident.resolvedAt ?? now) + 5 * MIN);
  const logs = useMemo(() => {
    const all = generateLogs({ from, to, incidents, budget: 2500 });
    return all.filter((l) => (services.size ? services.has(l.service) : true) && (level === "all" || l.level === "WARN" || l.level === "ERROR" || l.level === "FATAL"));
  }, [from, to, incidents, services, level]);
  const svcParam = [...services].join(",");
  const href = `/logs?service=${encodeURIComponent(svcParam)}&from=${from}&to=${to}${level === "problems" ? "&level=WARN,ERROR,FATAL" : ""}`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
        <Segmented
          size="xs"
          value={level}
          onChange={setLevel}
          options={[
            { value: "problems", label: "Warnings and errors" },
            { value: "all", label: "All levels" },
          ]}
        />
        <span className="text-[12px] text-ink-subtle">
          {logs.length.toLocaleString()} lines from {services.size} services during the incident window
        </span>
        <Link href={href} className={buttonClass({ variant: "outline", size: "xs", className: "ml-auto" })}>
          <ScrollText className="h-3 w-3" /> Open in Log Explorer
        </Link>
      </div>
      {logs.length === 0 ? (
        <EmptyState icon={ScrollText} title="No matching log lines" body="Nothing at this level in the incident window. Try All levels." />
      ) : (
        <ul className="max-h-[620px] overflow-y-auto">
          {logs.slice(0, 150).map((l) => (
            <LogRow key={l.id} log={l} compact />
          ))}
        </ul>
      )}
      {logs.length > 150 && <p className="border-t border-hairline px-4 py-2.5 text-[11.5px] text-ink-subtle">Showing the latest 150 lines. Open the Log Explorer for search, filters and trace correlation.</p>}
    </div>
  );
}

export function PostmortemTab({ incident, analysis, onRunAnalysis }: { incident: Incident; analysis?: Analysis; onRunAnalysis: () => void }) {
  const now = useSentinel((s) => s.now);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const pm = useMemo(() => {
    if (!analysis || !generatedAt) return null;
    const st = useSentinel.getState();
    // refresh the evidence if the cached analysis was written before the incident's outcome was known
    const a = analysisIsStale(incident, analysis, generatedAt) ? analyzeIncident({ incident, incidents: st.incidents, changes: st.changes, now: generatedAt }) : analysis;
    return buildPostmortem(incident, a, generatedAt);
  }, [incident, analysis, generatedAt]);

  if (!analysis) {
    return <EmptyState icon={FileText} title="Run the root cause analysis first" body="The postmortem is assembled from the incident timeline and Sentinel's analysis of the evidence." action={<Button variant="primary" onClick={onRunAnalysis}>Go to analysis</Button>} className="py-16" />;
  }
  if (!pm) {
    return (
      <EmptyState
        icon={FileText}
        title={incident.status === "resolved" ? "Generate the postmortem" : "Draft a postmortem"}
        body={
          incident.status === "resolved"
            ? "Sentinel will write an executive summary, timeline, root cause, business impact, what went well and wrong, and action items with owners."
            : "This incident is still active. You can draft a postmortem now and regenerate it after resolution."
        }
        action={
          <Button
            variant="primary"
            onClick={() => {
              setGeneratedAt(now || Date.now());
              toast.success("Postmortem generated");
            }}
          >
            <FileText className="h-3.5 w-3.5" /> {incident.status === "resolved" ? "Generate postmortem" : "Draft postmortem"}
          </Button>
        }
        className="py-16"
      />
    );
  }
  const md = postmortemMarkdown(pm);
  return (
    <div>
      <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 border-b border-hairline bg-panel/95 px-4 py-2.5 backdrop-blur">
        <span className="text-[12px] text-ink-subtle">Generated {new Date(pm.generatedAt).toLocaleTimeString("en-US", { hour12: false })}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="xs" variant="ghost" onClick={() => setGeneratedAt(Date.now())}>
            Regenerate
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              navigator.clipboard?.writeText(md).then(
                () => toast.success("Markdown copied"),
                () => toast.error("Clipboard unavailable. Use Download instead.")
              );
            }}
          >
            <ClipboardCopy className="h-3 w-3" /> Copy Markdown
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              downloadText(`postmortem-${incident.id.toLowerCase()}.md`, md);
              toast.success("Markdown downloaded", { description: `postmortem-${incident.id.toLowerCase()}.md` });
            }}
          >
            <Download className="h-3 w-3" /> Download .md
          </Button>
          <Link href={`/report/${incident.id}`} target="_blank" className={buttonClass({ variant: "primary", size: "xs" })}>
            <ExternalLink className="h-3 w-3" /> Print or save as PDF
          </Link>
        </div>
      </div>
      <div className="px-5 py-6 sm:px-8">
        <PostmortemView pm={pm} />
      </div>
    </div>
  );
}

export { ServiceChip };
