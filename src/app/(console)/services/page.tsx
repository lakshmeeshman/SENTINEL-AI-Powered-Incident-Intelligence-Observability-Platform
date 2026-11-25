"use client";

import "@xyflow/react/dist/style.css";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type NodeChange } from "@xyflow/react";
import { Crosshair, Info, Maximize2 } from "lucide-react";
import { SERVICES, SERVICE_MAP, upstreamOf } from "@/lib/catalog/services";
import { allHealth, statusTone, type HealthStatus } from "@/lib/analytics/health";
import { usePlatformHealth } from "@/lib/hooks";
import { useSentinel } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button, Segmented, Skeleton, TONE } from "@/components/ui/primitives";
import { Tip } from "@/components/ui/overlays";
import { ServiceNode, type MapMetric, type ServiceFlowNode } from "@/components/services/service-node";
import { ServicePanel } from "@/components/services/service-panel";

const nodeTypes = { service: ServiceNode };
const EDGE_COLOR: Record<HealthStatus, string> = { healthy: "rgba(148,163,196,0.32)", degraded: "#fbbf24", critical: "#f43f5e" };

export default function ServicesPage() {
  return (
    <Suspense>
      <ReactFlowProvider>
        <ServiceMap />
      </ReactFlowProvider>
    </Suspense>
  );
}

function ServiceMap() {
  const router = useRouter();
  const params = useSearchParams();
  const ready = useSentinel((s) => s.hydrated);
  const now = useSentinel((s) => s.now);
  const incidents = useSentinel((s) => s.incidents);
  const changes = useSentinel((s) => s.changes);
  const platform = usePlatformHealth();
  const { fitView } = useReactFlow();

  const [selected, setSelected] = useState<string | null>(params.get("service"));
  const [mode, setMode] = useState<"health" | "blast">("health");
  const [metric, setMetric] = useState<MapMetric>("latency");
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => Object.fromEntries(SERVICES.map((s) => [s.id, s.position])));

  useEffect(() => {
    const p = params.get("service");
    if (p && SERVICE_MAP[p]) setSelected(p);
  }, [params]);

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      router.replace(id ? `/services?service=${id}` : "/services", { scroll: false });
    },
    [router]
  );

  const panelOpen = !!selected;
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 350 }), 60);
    return () => clearTimeout(t);
  }, [panelOpen, fitView]);

  const health = useMemo(() => (platform ? Object.fromEntries(allHealth(platform.snapshot).map((h) => [h.id, h])) : {}), [platform]);
  const blast = useMemo(() => (mode === "blast" && selected ? upstreamOf(selected, 6) : null), [mode, selected]);
  const activeBySvc = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of incidents) if (i.status !== "resolved") for (const s of i.affectedServices) m[s] = (m[s] ?? 0) + 1;
    return m;
  }, [incidents]);

  const nodes: ServiceFlowNode[] = useMemo(() => {
    if (!platform) return [];
    return SERVICES.map((svc) => ({
      id: svc.id,
      type: "service",
      position: positions[svc.id] ?? svc.position,
      data: {
        svc,
        m: platform.snapshot[svc.id]!,
        status: health[svc.id]?.status ?? "healthy",
        selected: selected === svc.id,
        dim: !!blast && !blast.has(svc.id),
        hop: blast?.get(svc.id),
        metric,
        incidents: activeBySvc[svc.id] ?? 0,
      },
    }));
  }, [platform, positions, health, selected, blast, metric, activeBySvc]);

  const edges: Edge[] = useMemo(() => {
    if (!platform) return [];
    const out: Edge[] = [];
    for (const svc of SERVICES) {
      for (const dep of svc.dependencies) {
        const target = health[dep]?.status ?? "healthy";
        const unhealthy = target !== "healthy";
        const inBlast = blast ? blast.has(svc.id) && blast.has(dep) : false;
        const rps = platform.snapshot[dep]?.rps ?? 100;
        const w = Math.max(1, Math.min(4, Math.log10(rps) - 1.3));
        const color = blast ? (inBlast ? "#8b7cf6" : "rgba(148,163,196,0.12)") : EDGE_COLOR[target];
        out.push({
          id: `${svc.id}->${dep}`,
          source: svc.id,
          target: dep,
          animated: blast ? inBlast : unhealthy,
          style: { stroke: color, strokeWidth: unhealthy || inBlast ? w + 0.5 : w, opacity: blast && !inBlast ? 0.5 : 1 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
          zIndex: unhealthy || inBlast ? 2 : 1,
        });
      }
    }
    return out;
  }, [platform, health, blast]);

  const onNodesChange = useCallback((changes: NodeChange<ServiceFlowNode>[]) => {
    const moved = changes.filter((c) => c.type === "position" && c.position);
    if (!moved.length) return;
    setPositions((prev) => {
      const next = { ...prev };
      for (const c of moved) if (c.type === "position" && c.position) next[c.id] = c.position;
      return next;
    });
  }, []);

  const counts = useMemo(() => {
    const c = { healthy: 0, degraded: 0, critical: 0 };
    for (const h of Object.values(health)) c[h.status]++;
    return c;
  }, [health]);

  if (!ready || !platform) {
    return (
      <div className="h-[calc(100dvh-56px)] p-4">
        <Skeleton className="h-full w-full rounded-[10px]" />
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100dvh-56px)] min-h-[560px] w-full">
      <div className={cn("pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start gap-2 transition-[right] duration-300 sm:inset-x-5", panelOpen && "lg:right-[452px]")}>
        <div className="glass pointer-events-auto rounded-[10px] px-3.5 py-2.5">
          <h1 className="text-[15px] font-semibold tracking-[-0.02em]">Service map</h1>
          <div className="mt-1 flex items-center gap-3 text-[11.5px] text-ink-muted">
            {(["healthy", "degraded", "critical"] as HealthStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", TONE[statusTone(s)].dot)} />
                <span className="tabular">{counts[s]}</span> {s}
              </span>
            ))}
          </div>
        </div>
        <div className="glass pointer-events-auto flex flex-wrap items-center gap-2 rounded-[10px] p-1.5">
          <Segmented
            size="xs"
            value={mode}
            onChange={(v) => {
              setMode(v);
              if (v === "blast" && !selected) select("postgres-primary");
            }}
            options={[
              { value: "health", label: "Live health" },
              { value: "blast", label: "Blast radius" },
            ]}
          />
          <Segmented
            size="xs"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "latency", label: "Latency" },
              { value: "errors", label: "Errors" },
              { value: "traffic", label: "Traffic" },
            ]}
          />
          <Tip content="Fit to screen">
            <Button variant="ghost" size="icon-sm" onClick={() => fitView({ padding: 0.15, duration: 400 })} aria-label="Fit to screen">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <Tip content="Reset layout">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setPositions(Object.fromEntries(SERVICES.map((s) => [s.id, s.position])));
                setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 30);
              }}
              aria-label="Reset layout"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </Button>
          </Tip>
        </div>
        {mode === "blast" && (
          <div className="glass pointer-events-auto flex max-w-md items-start gap-2 rounded-[10px] px-3 py-2 text-[12px] text-ink-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-intel-bright" />
            {selected ? (
              <span>
                If <span className="font-mono text-ink">{selected}</span> fails, {blast ? blast.size - 1 : 0} service{blast && blast.size - 1 === 1 ? "" : "s"} upstream can be impacted. Badges show hops from the failure.
              </span>
            ) : (
              <span>Select a service to see which services depend on it.</span>
            )}
          </div>
        )}
      </div>

      <div className={cn("h-full w-full transition-[padding] duration-300", panelOpen && "lg:pr-[436px]")}>
      <ReactFlow<ServiceFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.25}
        maxZoom={1.8}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(148,163,196,0.14)" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      </div>

      <AnimatePresence>
        {selected && SERVICE_MAP[selected] && (
          <ServicePanel key={selected} id={selected} now={now} incidents={incidents} changes={changes} onSelect={(id) => select(id)} onClose={() => select(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

