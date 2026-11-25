"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ArrowDownWideNarrow, Check, CheckCircle2, Copy, Eye, FilePlus2, MoreHorizontal, Search, SearchX, Siren, Zap } from "lucide-react";
import { toast } from "sonner";
import { SERVICES } from "@/lib/catalog/services";
import { STATUS_LABEL, STATUS_ORDER, useSentinel } from "@/lib/store";
import type { Incident, IncidentStatus, Severity } from "@/lib/types";
import { cn, formatDateTime, formatDuration, timeAgo } from "@/lib/utils";
import { Page, PageHeader } from "@/components/ui/page";
import { Avatar, Button, EmptyState, Input, Panel, SEV_TONE, Segmented, Select, ServiceChip, SeverityBadge, Skeleton, StatusBadge, StatusIcon, TONE } from "@/components/ui/primitives";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/overlays";
import { ResolveDialog, useIncidentActions } from "@/components/incidents/incident-actions";
import { useSimulate } from "@/components/shell/topbar";
import { useUI } from "@/components/shell/ui-store";

type Scope = "active" | "resolved" | "all";
type Sort = "newest" | "oldest" | "severity" | "duration" | "status";
const SEVS: Severity[] = ["SEV-1", "SEV-2", "SEV-3", "SEV-4"];

export default function IncidentsPage() {
  return (
    <Suspense>
      <IncidentsView />
    </Suspense>
  );
}

function IncidentsView() {
  const params = useSearchParams();
  const incidents = useSentinel((s) => s.incidents);
  const now = useSentinel((s) => s.now);
  const ready = useSentinel((s) => s.hydrated);
  const simulate = useSimulate();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [scope, setScope] = useState<Scope>((params.get("scope") as Scope) ?? "all");
  const [sevs, setSevs] = useState<Severity[]>([]);
  const [statuses, setStatuses] = useState<IncidentStatus[]>([]);
  const [service, setService] = useState(params.get("service") ?? "");
  const [sort, setSort] = useState<Sort>("newest");
  const [resolving, setResolving] = useState<Incident | null>(null);

  const stats = useMemo(() => {
    const week = incidents.filter((i) => i.detectedAt >= now - 7 * 86_400_000);
    const acked = week.filter((i) => i.acknowledgedAt);
    const resolved = week.filter((i) => i.resolvedAt);
    const mtta = acked.length ? acked.reduce((a, i) => a + (i.acknowledgedAt! - i.detectedAt), 0) / acked.length : 0;
    const mttr = resolved.length ? resolved.reduce((a, i) => a + (i.resolvedAt! - i.impactStartedAt), 0) / resolved.length : 0;
    return { open: incidents.filter((i) => i.status !== "resolved").length, mtta, mttr, resolved: resolved.length, total: week.length };
  }, [incidents, now]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = incidents.filter((i) => {
      if (scope === "active" && i.status === "resolved") return false;
      if (scope === "resolved" && i.status !== "resolved") return false;
      if (sevs.length && !sevs.includes(i.severity)) return false;
      if (statuses.length && !statuses.includes(i.status)) return false;
      if (service && !i.affectedServices.includes(service)) return false;
      if (needle) {
        const hay = `${i.id} ${i.title} ${i.description} ${i.affectedServices.join(" ")} ${i.commander ?? ""} ${i.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dur = (i: Incident) => (i.resolvedAt ?? now) - i.impactStartedAt;
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.detectedAt - b.detectedAt;
        case "severity":
          return a.severity.localeCompare(b.severity) || b.detectedAt - a.detectedAt;
        case "duration":
          return dur(b) - dur(a);
        case "status":
          return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.detectedAt - a.detectedAt;
        default:
          return b.detectedAt - a.detectedAt;
      }
    });
    return list;
  }, [incidents, q, scope, sevs, statuses, service, sort, now]);

  const filtered = q || sevs.length || statuses.length || service || scope !== "all";
  const clear = () => {
    setQ("");
    setScope("all");
    setSevs([]);
    setStatuses([]);
    setService("");
  };

  return (
    <Page>
      <PageHeader
        title="Incidents"
        description="Every incident Sentinel detected or a responder declared, with live status and impact."
        actions={
          <>
            <Button variant="secondary" onClick={() => useUI.getState().set({ createIncident: true })}>
              <FilePlus2 className="h-3.5 w-3.5" /> Declare incident
            </Button>
            <Button variant="primary" onClick={() => simulate(undefined, true)}>
              <Zap className="h-3.5 w-3.5" /> Simulate incident
            </Button>
          </>
        }
      />

      <div className="panel mb-4 grid grid-cols-2 gap-px overflow-hidden bg-hairline md:grid-cols-4">
        {[
          { label: "Open now", value: ready ? String(stats.open) : "—", hint: "Not yet resolved" },
          { label: "Mean time to acknowledge", value: ready && stats.mtta ? formatDuration(stats.mtta, { short: true }) : "—", hint: "Last 7 days" },
          { label: "Mean time to resolve", value: ready && stats.mttr ? formatDuration(stats.mttr, { short: true }) : "—", hint: "Last 7 days, from first impact" },
          { label: "Resolved", value: ready ? `${stats.resolved} of ${stats.total}` : "—", hint: "Incidents opened in the last 7 days" },
        ].map((s) => (
          <div key={s.label} className="bg-panel px-4 py-3.5">
            <p className="text-[12px] text-ink-muted">{s.label}</p>
            <p className="tabular mt-1 text-[20px] font-semibold tracking-[-0.02em]">{s.value}</p>
            <p className="text-[11px] text-ink-subtle">{s.hint}</p>
          </div>
        ))}
      </div>

      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-hairline p-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1 lg:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
            <Input data-page-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ID, title, service or person" className="pl-8" aria-label="Search incidents" />
          </div>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "resolved", label: "Resolved" },
            ]}
          />
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by severity">
            {SEVS.map((s) => {
              const on = sevs.includes(s);
              return (
                <button
                  key={s}
                  aria-pressed={on}
                  onClick={() => setSevs((cur) => (on ? cur.filter((x) => x !== s) : [...cur, s]))}
                  className={cn(
                    "h-7 rounded-[6px] px-2 font-mono text-[11px] font-semibold ring-1 ring-inset transition",
                    on ? cn(TONE[SEV_TONE[s]].bg, TONE[SEV_TONE[s]].text, TONE[SEV_TONE[s]].ring) : "text-ink-subtle ring-hairline-strong hover:text-ink-muted"
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="outline" size="sm">
                  Status{statuses.length ? ` · ${statuses.length}` : ""}
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownLabel>Filter by status</DropdownLabel>
                {STATUS_ORDER.map((s) => (
                  <DropdownItem
                    key={s}
                    inset
                    checked={statuses.includes(s)}
                    onSelect={(e) => {
                      e.preventDefault();
                      setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
                    }}
                  >
                    <StatusIcon status={s} /> {STATUS_LABEL[s]}
                  </DropdownItem>
                ))}
              </DropdownContent>
            </Dropdown>
            <Select value={service} onChange={(e) => setService(e.target.value)} className="w-44" aria-label="Filter by service">
              <option value="">All services</option>
              {SERVICES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <ArrowDownWideNarrow className="h-3.5 w-3.5 text-ink-subtle" />
              <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-36" aria-label="Sort">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="severity">Severity</option>
                <option value="duration">Longest duration</option>
                <option value="status">Status</option>
              </Select>
            </div>
          </div>
        </div>

        {!ready ? (
          <div className="space-y-px">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="No incidents match these filters" body="Try a broader search or clear the filters." action={<Button onClick={clear}>Clear filters</Button>} className="py-16" />
          ) : (
            <EmptyState icon={Siren} title="No incidents yet" body="Sentinel opens incidents automatically when it detects anomalies. You can also declare one or simulate a failure." action={<Button variant="primary" onClick={() => simulate(undefined, true)}>Simulate incident</Button>} className="py-16" />
          )
        ) : (
          <>
            <div className="hidden grid-cols-[88px_minmax(0,1fr)_138px_150px_120px_96px_40px] gap-4 border-b border-hairline px-4 py-2 text-[11.5px] font-medium text-ink-subtle lg:grid">
              <span>Severity</span>
              <span>Incident</span>
              <span>Status</span>
              <span>Commander</span>
              <span>Detected</span>
              <span>Duration</span>
              <span className="sr-only">Actions</span>
            </div>
            <ul className="divide-y divide-hairline">
              {rows.map((i) => (
                <IncidentRow key={i.id} incident={i} now={now} onResolve={() => setResolving(i)} />
              ))}
            </ul>
            <p className="border-t border-hairline px-4 py-2.5 text-[11.5px] text-ink-subtle">
              Showing {rows.length} of {incidents.length} incidents
              {filtered && (
                <button onClick={clear} className="ml-2 text-intel-bright hover:underline">
                  Clear filters
                </button>
              )}
            </p>
          </>
        )}
      </Panel>
      {resolving && <ResolveDialog incident={resolving} open={!!resolving} onOpenChange={(v) => !v && setResolving(null)} />}
    </Page>
  );
}

function IncidentRow({ incident: i, now, onResolve }: { incident: Incident; now: number; onResolve: () => void }) {
  const router = useRouter();
  const actions = useIncidentActions();
  const active = i.status !== "resolved";
  const duration = (i.resolvedAt ?? now) - i.impactStartedAt;
  return (
    <li className="group relative grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 px-4 py-3 transition hover:bg-white/[0.02] lg:grid-cols-[88px_minmax(0,1fr)_138px_150px_120px_96px_40px] lg:items-center lg:gap-4">
      <div className="flex items-center gap-2">
        <SeverityBadge severity={i.severity} pulse={active && (i.severity === "SEV-1" || i.severity === "SEV-2")} />
        <span className="font-mono text-[11px] text-ink-subtle lg:hidden">{i.id}</span>
      </div>
      <Link href={`/incidents/${i.id}`} className="col-span-2 min-w-0 after:absolute after:inset-0 lg:col-span-1">
        <p className="flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-ink-subtle lg:inline">{i.id}</span>
          <span className="truncate text-[13.5px] font-medium text-ink group-hover:text-white">{i.title}</span>
        </p>
        <span className="mt-1 flex flex-wrap gap-1">
          {i.affectedServices.slice(0, 4).map((s) => (
            <ServiceChip key={s} id={s} />
          ))}
          {i.source === "manual" && <span className="text-[11px] text-ink-subtle">· declared manually</span>}
          {i.source === "simulation" && <span className="text-[11px] text-ink-subtle">· simulated</span>}
        </span>
      </Link>
      <div>
        <StatusBadge status={i.status} />
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink-muted">
        {i.commander ? (
          <>
            <Avatar name={i.commander} className="h-5 w-5 text-[8.5px]" />
            <span className="truncate">{i.commander}</span>
          </>
        ) : (
          <span className="text-ink-subtle">Unassigned</span>
        )}
      </div>
      <div className="text-[12px] text-ink-muted" title={formatDateTime(i.detectedAt)}>
        <span className="tabular">{timeAgo(i.detectedAt, now)}</span>
      </div>
      <div className={cn("tabular text-[12px]", active ? "text-ink" : "text-ink-muted")}>{formatDuration(duration, { short: true })}</div>
      <div className="relative z-10 col-start-2 row-start-1 justify-self-end lg:col-start-auto lg:row-start-auto">
        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${i.id}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownTrigger>
          <DropdownContent>
            <DropdownItem onSelect={() => router.push(`/incidents/${i.id}`)}>
              <Eye className="h-3.5 w-3.5" /> Open incident
            </DropdownItem>
            {i.status === "open" && (
              <DropdownItem onSelect={() => actions.acknowledge(i)}>
                <Check className="h-3.5 w-3.5" /> Acknowledge
              </DropdownItem>
            )}
            {active && i.status !== "monitoring" && (
              <DropdownItem onSelect={() => actions.setStatus(i, "monitoring")}>
                <StatusIcon status="monitoring" /> Mark as monitoring
              </DropdownItem>
            )}
            {active && (
              <DropdownItem onSelect={onResolve}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
              </DropdownItem>
            )}
            <DropdownSeparator />
            <DropdownItem
              onSelect={() => {
                navigator.clipboard?.writeText(`${location.origin}/incidents/${i.id}`).catch(() => {});
                toast.success("Link copied");
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy link
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    </li>
  );
}
