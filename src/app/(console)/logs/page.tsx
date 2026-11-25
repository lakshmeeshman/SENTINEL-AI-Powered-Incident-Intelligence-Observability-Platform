"use client";

import { Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, Download, ScrollText, Search, SearchX, X } from "lucide-react";
import { SERVICES } from "@/lib/catalog/services";
import { useSentinel } from "@/lib/store";
import { LEVELS, generateLogs, logHistogram } from "@/lib/sim/logs";
import { RANGE_MS } from "@/lib/sim/telemetry";
import type { LogLevel, TimeRange } from "@/lib/types";
import { cn, downloadText, formatClock, formatDateTime } from "@/lib/utils";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, EmptyState, Input, Panel, Segmented, Skeleton } from "@/components/ui/primitives";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/overlays";
import { LEVEL_COLOR, LogHistogram } from "@/components/charts/charts";
import { LogRow } from "@/components/logs/log-row";

const PAGE = 200;

export default function LogsPage() {
  return (
    <Suspense>
      <LogExplorer />
    </Suspense>
  );
}

function parseList(v: string | null) {
  return v ? v.split(",").filter(Boolean) : [];
}

function LogExplorer() {
  const params = useSearchParams();
  const router = useRouter();
  const ready = useSentinel((s) => s.hydrated);
  const now = useSentinel((s) => s.now);
  const live = useSentinel((s) => s.live);
  const incidents = useSentinel((s) => s.incidents);

  const incidentParam = params.get("incident");
  const linked = incidents.find((i) => i.id === incidentParam);

  const [range, setRange] = useState<TimeRange>("1h");
  const [custom, setCustom] = useState<{ from: number; to: number } | null>(() => {
    const f = Number(params.get("from"));
    const t = Number(params.get("to"));
    return f && t ? { from: f, to: t } : null;
  });
  const [levels, setLevels] = useState<LogLevel[]>(() => parseList(params.get("level")) as LogLevel[]);
  const [services, setServices] = useState<string[]>(() => parseList(params.get("service")));
  const [q, setQ] = useState(params.get("q") ?? "");
  const [trace, setTrace] = useState<string | null>(params.get("trace"));
  const [incidentId, setIncidentId] = useState<string | null>(incidentParam);
  const [limit, setLimit] = useState(PAGE);
  const dq = useDeferredValue(q);

  useEffect(() => {
    if (linked && !custom) setCustom({ from: linked.impactStartedAt - 5 * 60_000, to: Math.min(Date.now(), (linked.resolvedAt ?? Date.now()) + 5 * 60_000) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked?.id]);

  useEffect(() => setLimit(PAGE), [dq, levels, services, trace, range, custom, incidentId]);

  const window_ = custom ?? (now ? { from: now - RANGE_MS[range], to: now } : null);

  const base = useMemo(() => (window_ && ready ? generateLogs({ from: window_.from, to: window_.to, incidents, budget: 3200 }) : []), [window_?.from, window_?.to, incidents, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const { rows, levelCounts, serviceCounts } = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    const pre = base.filter((l) => {
      if (services.length && !services.includes(l.service)) return false;
      if (trace && l.traceId !== trace) return false;
      if (incidentId && l.incidentId !== incidentId) return false;
      if (needle) {
        const hay = `${l.message} ${l.service} ${l.traceId} ${l.host} ${l.level}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const levelCounts = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<LogLevel, number>;
    for (const l of pre) levelCounts[l.level]++;
    const serviceCounts: Record<string, number> = {};
    for (const l of base) serviceCounts[l.service] = (serviceCounts[l.service] ?? 0) + 1;
    return { rows: levels.length ? pre.filter((l) => levels.includes(l.level)) : pre, levelCounts, serviceCounts };
  }, [base, dq, services, trace, incidentId, levels]);

  const hist = useMemo(() => (window_ ? logHistogram(rows, window_.from, window_.to, 64) : []), [rows, window_?.from, window_?.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearAll = () => {
    setQ("");
    setLevels([]);
    setServices([]);
    setTrace(null);
    setIncidentId(null);
    setCustom(null);
    router.replace("/logs", { scroll: false });
  };
  const anyFilter = !!(q || levels.length || services.length || trace || incidentId || custom);
  const tailing = live && !custom;

  const exportJson = () => {
    const data = rows.slice(0, 5000).map((l) => ({ timestamp: new Date(l.t).toISOString(), level: l.level, service: l.service, message: l.message, trace_id: l.traceId, span_id: l.spanId, host: l.host, ...l.attrs }));
    downloadText(`sentinel-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.ndjson`, data.map((d) => JSON.stringify(d)).join("\n"), "application/x-ndjson");
  };

  return (
    <Page wide>
      <PageHeader
        title="Log explorer"
        description="Structured logs from every service, correlated by trace ID. Click a bar in the histogram to zoom in, or expand a line to follow its trace."
        actions={
          <>
            {!custom && (
              <Segmented
                value={range}
                onChange={setRange}
                options={(["15m", "1h", "6h", "24h"] as TimeRange[]).map((r) => ({ value: r, label: r, title: `Last ${r}` }))}
              />
            )}
            <Button variant="outline" onClick={exportJson} disabled={!rows.length}>
              <Download className="h-3.5 w-3.5" /> Export NDJSON
            </Button>
          </>
        }
      />

      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-hairline p-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
            <Input data-page-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages, trace IDs, hosts…   ( / )" className="pl-8 font-mono text-[12.5px]" aria-label="Search logs" />
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by level">
            {LEVELS.map((l) => {
              const on = levels.includes(l);
              return (
                <button
                  key={l}
                  aria-pressed={on}
                  onClick={() => setLevels((cur) => (on ? cur.filter((x) => x !== l) : [...cur, l]))}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-[6px] px-2 font-mono text-[11px] ring-1 ring-inset transition",
                    on ? "bg-white/[0.07] text-ink ring-hairline-strong" : levels.length ? "text-ink-faint ring-hairline hover:text-ink-muted" : "text-ink-muted ring-hairline hover:text-ink"
                  )}
                >
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: LEVEL_COLOR[l] }} />
                  {l}
                  <span className="tabular text-ink-subtle">{levelCounts[l].toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="outline">
                <Boxes className="h-3.5 w-3.5" /> {services.length ? `${services.length} service${services.length > 1 ? "s" : ""}` : "All services"}
              </Button>
            </DropdownTrigger>
            <DropdownContent className="max-h-[420px] w-64 overflow-y-auto">
              <DropdownLabel>Filter by service</DropdownLabel>
              {SERVICES.map((s) => (
                <DropdownItem
                  key={s.id}
                  inset
                  checked={services.includes(s.id)}
                  onSelect={(e) => {
                    e.preventDefault();
                    setServices((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]));
                  }}
                >
                  <span className="font-mono text-[12px]">{s.id}</span>
                  <span className="tabular ml-auto text-[11px] text-ink-subtle">{serviceCounts[s.id] ?? 0}</span>
                </DropdownItem>
              ))}
              {services.length > 0 && (
                <>
                  <DropdownSeparator />
                  <DropdownItem onSelect={() => setServices([])}>Clear service filter</DropdownItem>
                </>
              )}
            </DropdownContent>
          </Dropdown>
        </div>

        {(anyFilter || tailing) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2 text-[12px]">
            {tailing && (
              <span className="flex items-center gap-1.5 text-signal">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inset-0 animate-pulse-ring rounded-full bg-signal" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-signal" />
                </span>
                Live tail
              </span>
            )}
            {custom && <Chip onClear={() => setCustom(null)}>{`${formatDateTime(custom.from)} → ${formatClock(custom.to)}`}</Chip>}
            {trace && (
              <Chip onClear={() => setTrace(null)}>
                trace <span className="font-mono text-signal">{trace}</span>
              </Chip>
            )}
            {incidentId && <Chip onClear={() => setIncidentId(null)}>correlated with {incidentId}</Chip>}
            {services.map((s) => (
              <Chip key={s} onClear={() => setServices((cur) => cur.filter((x) => x !== s))}>
                <span className="font-mono">{s}</span>
              </Chip>
            ))}
            {anyFilter && (
              <button onClick={clearAll} className="ml-auto text-ink-subtle hover:text-ink">
                Clear all
              </button>
            )}
          </div>
        )}

        <div className="border-b border-hairline px-3 pb-1 pt-3">
          {ready ? <LogHistogram data={hist} onSelect={(from, to) => setCustom({ from, to })} /> : <Skeleton className="h-[92px] w-full" />}
        </div>

        <div className="hidden items-center gap-3 border-b border-hairline bg-white/[0.012] px-3 py-1.5 pl-[38px] font-mono text-[10.5px] text-ink-subtle md:flex">
          <span className="w-[92px]">time</span>
          <span className="w-[42px]">level</span>
          <span className="w-[150px]">service</span>
          <span className="flex-1">message</span>
          <span className="hidden xl:block">trace</span>
        </div>

        {!ready ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          anyFilter ? (
            <EmptyState icon={SearchX} title="No log lines match" body="Widen the time range or remove a filter." action={<Button onClick={clearAll}>Clear filters</Button>} className="py-16" />
          ) : (
            <EmptyState icon={ScrollText} title="No logs in this window" className="py-16" />
          )
        ) : (
          <>
            <ul>
              {rows.slice(0, limit).map((l) => (
                <LogRow key={l.id} log={l} needle={dq.trim()} onTrace={(t) => setTrace(t)} />
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-hairline px-3 py-2.5 text-[11.5px] text-ink-subtle">
              <span>
                Showing {Math.min(limit, rows.length).toLocaleString()} of {rows.length.toLocaleString()} matching lines ({base.length.toLocaleString()} in window
                {!custom && RANGE_MS[range] > 3_600_000 ? ", baseline lines sampled; warnings and errors kept" : ""})
              </span>
              {limit < rows.length && (
                <Button size="xs" variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
                  Load {Math.min(PAGE, rows.length - limit)} more
                </Button>
              )}
            </div>
          </>
        )}
      </Panel>
    </Page>
  );
}

function Chip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-[5px] bg-white/[0.04] pl-2 pr-1 text-ink-muted ring-1 ring-hairline-strong">
      {children}
      <button onClick={onClear} className="rounded-[3px] p-0.5 text-ink-subtle hover:bg-white/10 hover:text-ink" aria-label="Remove filter">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
