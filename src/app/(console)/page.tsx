"use client";

import { useMemo, useState } from "react";
import { FilePlus2, Zap } from "lucide-react";
import { SERVICES } from "@/lib/catalog/services";
import { detectAdaptive } from "@/lib/analytics/anomaly";
import { useTelemetry } from "@/lib/hooks";
import { useSentinel } from "@/lib/store";
import { buildFeed } from "@/lib/sim/feed";
import { RANGE_STEP, serviceSeries } from "@/lib/sim/telemetry";
import type { Severity, TimeRange } from "@/lib/types";
import { formatCompact, formatMs, formatPct } from "@/lib/utils";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, Panel, PanelHeader, Segmented, SEV_HEX, Select, Skeleton } from "@/components/ui/primitives";
import { CHART, Legend, TimeSeriesChart, type Band, type Marker } from "@/components/charts/charts";
import { SignalStrip } from "@/components/dashboard/signal-strip";
import { ActiveIncidents, LiveFeed, RecentActivity, ServiceHealthGrid, TopAffected } from "@/components/dashboard/panels";
import { useSimulate } from "@/components/shell/topbar";
import { useUI } from "@/components/shell/ui-store";

const PREFIX = 40;
const DAY = 86_400_000;

export default function OverviewPage() {
  const defaultRange = useSentinel((s) => s.settings.defaultRange);
  const [range, setRange] = useState<TimeRange>(defaultRange);
  const [latencySvc, setLatencySvc] = useState("api-gateway");
  const tel = useTelemetry(range, PREFIX);
  const incidents = useSentinel((s) => s.incidents);
  const changes = useSentinel((s) => s.changes);
  const now = useSentinel((s) => s.now);
  const live = useSentinel((s) => s.live);
  const simulate = useSimulate();

  const derived = useMemo(() => {
    if (!tel) return null;
    const gwAll = tel.series["api-gateway"]!;
    const gw = gwAll.slice(PREFIX);
    const times = tel.times.slice(PREFIX);
    const compare = serviceSeries("api-gateway", times.map((t) => t - DAY), incidents);
    const traffic = gw.map((p, i) => ({ t: p.t, rps: p.rps, yesterday: compare[i]?.rps ?? 0 }));
    const det = detectAdaptive(
      gwAll.map((p) => ({ t: p.t, v: p.errorRate })),
      { window: 40, threshold: 4, minRun: 2, minRelative: 1.2, adaptAfter: Infinity }
    );
    const bands: Band[] = det.segments.map((s) => ({ x1: s.start, x2: s.end + RANGE_STEP[range] }));
    const errors = gw.map((p, i) => ({ t: p.t, errorRate: p.errorRate, baseline: det.baseline[i + PREFIX] ?? 0 }));
    const from = times[0]!;
    const markers: Marker[] = incidents
      .filter((i) => i.detectedAt >= from && i.detectedAt <= now)
      .map((i) => ({ t: i.detectedAt, label: i.id, color: SEV_HEX[i.severity] }));
    const sevCounts = { "SEV-1": 0, "SEV-2": 0, "SEV-3": 0, "SEV-4": 0 } as Record<Severity, number>;
    for (const i of tel.active) sevCounts[i.severity]++;
    return { traffic, errors, bands, markers, compare, sevCounts, tailSeries: Object.fromEntries(SERVICES.map((s) => [s.id, tel.series[s.id]!.slice(PREFIX)])) };
  }, [tel, incidents, range, now]);

  const latency = useMemo(() => {
    if (!tel) return [];
    return tel.series[latencySvc]!.slice(PREFIX).map((p) => ({ t: p.t, p50: p.p50, p95: p.p95, p99: p.p99 }));
  }, [tel, latencySvc]);

  const feed = useMemo(() => (now ? buildFeed(now, incidents, changes) : []), [now, incidents, changes]);

  return (
    <Page>
      <PageHeader
        title="Command center"
        description="Production, Acme Cloud. 13 services across us-east-1 and eu-west-1."
        actions={
          <>
            <Segmented
              value={range}
              onChange={setRange}
              options={(["15m", "1h", "6h", "24h"] as TimeRange[]).map((r) => ({ value: r, label: r, title: `Last ${r}` }))}
            />
            <Button variant="secondary" onClick={() => useUI.getState().set({ createIncident: true })}>
              <FilePlus2 className="h-3.5 w-3.5" /> Declare
            </Button>
            <Button variant="primary" onClick={() => simulate()}>
              <Zap className="h-3.5 w-3.5" /> Simulate incident
            </Button>
          </>
        }
      />

      {!tel || !derived ? (
        <OverviewSkeleton />
      ) : (
        <div className="space-y-4">
          <SignalStrip tel={tel} compare={derived.compare} sevCounts={derived.sevCounts} />

          <div className="grid gap-4 xl:grid-cols-12">
            <Panel className="xl:col-span-8">
              <PanelHeader
                title="Traffic"
                description={`Requests per second at api-gateway, last ${range}`}
                actions={
                  <Legend
                    items={[
                      { label: "Now", color: CHART.signal, value: formatCompact(tel.snapshot["api-gateway"]!.rps) },
                      { label: "Same time yesterday", color: CHART.compare, dashed: true },
                    ]}
                  />
                }
              />
              <div className="px-2 pb-2 pt-1">
                <TimeSeriesChart
                  data={derived.traffic}
                  animateKey={range}
                  height={250}
                  format={(v) => `${formatCompact(v)} req/s`}
                  yFormat={(v) => formatCompact(v)}
                  yDomain={[(min: number) => Math.floor(min * 0.8), (max: number) => Math.ceil(max * 1.04)]}
                  markers={derived.markers}
                  series={[
                    { key: "yesterday", label: "Yesterday", color: CHART.compare, type: "line", dashed: true, width: 1.25 },
                    { key: "rps", label: "Requests/s", color: CHART.signal, type: "area" },
                  ]}
                />
              </div>
            </Panel>
            <div className="xl:col-span-4">
              <ActiveIncidents incidents={incidents} now={now} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader
                title="Error rate"
                description={derived.bands.length ? `${derived.bands.length} anomalous window${derived.bands.length > 1 ? "s" : ""} flagged by the adaptive baseline` : "Within the adaptive baseline"}
                actions={
                  <Legend
                    items={[
                      { label: "5xx rate", color: CHART.signal, value: formatPct(tel.snapshot["api-gateway"]!.errorRate) },
                      { label: "Baseline", color: CHART.compare, dashed: true },
                      ...(derived.bands.length ? [{ label: "Anomaly", color: CHART.anomaly }] : []),
                    ]}
                  />
                }
              />
              <div className="px-2 pb-2 pt-1">
                <TimeSeriesChart
                  data={derived.errors}
                  animateKey={range}
                  height={210}
                  format={(v) => formatPct(v)}
                  yFormat={(v) => `${v.toFixed(v < 1 ? 2 : 1)}%`}
                  bands={derived.bands}
                  markers={derived.markers}
                  series={[
                    { key: "baseline", label: "Baseline", color: CHART.compare, type: "line", dashed: true, width: 1.25 },
                    { key: "errorRate", label: "Error rate", color: CHART.signal, type: "area" },
                  ]}
                />
              </div>
            </Panel>
            <Panel>
              <PanelHeader
                title="Latency percentiles"
                description="Distribution of response times"
                actions={
                  <Select value={latencySvc} onChange={(e) => setLatencySvc(e.target.value)} className="w-44" aria-label="Service">
                    {SERVICES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id}
                      </option>
                    ))}
                  </Select>
                }
              />
              <div className="px-4 pt-3">
                <Legend
                  items={[
                    { label: "p50", color: CHART.signalDim, value: formatMs(tel.snapshot[latencySvc]!.p50) },
                    { label: "p95", color: CHART.signal, value: formatMs(tel.snapshot[latencySvc]!.p95) },
                    { label: "p99", color: CHART.signalBright, value: formatMs(tel.snapshot[latencySvc]!.p99) },
                  ]}
                />
              </div>
              <div className="px-2 pb-2">
                <TimeSeriesChart
                  data={latency}
                  animateKey={`${range}-${latencySvc}`}
                  height={190}
                  format={(v) => formatMs(v)}
                  markers={derived.markers}
                  series={[
                    { key: "p50", label: "p50", color: CHART.signalDim, type: "line" },
                    { key: "p95", label: "p95", color: CHART.signal, type: "line" },
                    { key: "p99", label: "p99", color: CHART.signalBright, type: "line" },
                  ]}
                />
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-8">
              <ServiceHealthGrid health={tel.health} series={derived.tailSeries} />
            </div>
            <div className="xl:col-span-4">
              <LiveFeed events={feed} now={now} live={live} />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <RecentActivity incidents={incidents} now={now} />
            </div>
            <div className="xl:col-span-5">
              <TopAffected incidents={incidents} now={now} health={tel.health} />
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading telemetry">
      <div className="panel grid h-[164px] grid-cols-1 gap-6 p-5 lg:grid-cols-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-[110px] w-[110px] rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="hidden space-y-3 lg:block">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="mt-6 h-7 w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="panel h-[320px] p-4 xl:col-span-8">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-6 h-[230px] w-full" />
        </div>
        <div className="panel h-[320px] p-4 xl:col-span-4">
          <Skeleton className="h-4 w-36" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="mt-5 h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

