"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Boxes, Database, Globe, Layers, Network, Search, Workflow, Zap, type LucideIcon } from "lucide-react";
import type { HealthStatus } from "@/lib/analytics/health";
import type { MetricPoint, ServiceDef, ServiceKind } from "@/lib/types";
import { cn, formatCompact, formatMs, formatPct } from "@/lib/utils";

export const KIND_ICON: Record<ServiceKind, LucideIcon> = {
  edge: Globe,
  gateway: Network,
  service: Boxes,
  database: Database,
  cache: Zap,
  queue: Workflow,
  search: Search,
};

export type MapMetric = "latency" | "errors" | "traffic";

export type ServiceNodeData = {
  svc: ServiceDef;
  m: MetricPoint;
  status: HealthStatus;
  selected: boolean;
  dim: boolean;
  hop?: number;
  metric: MapMetric;
  incidents: number;
};

export type ServiceFlowNode = Node<ServiceNodeData, "service">;

const STATUS_RING: Record<HealthStatus, string> = {
  healthy: "ring-hairline-strong",
  degraded: "ring-warning/55",
  critical: "ring-critical/70",
};

function ServiceNodeImpl({ data }: NodeProps<ServiceFlowNode>) {
  const { svc, m, status, selected, dim, hop, metric, incidents } = data;
  const Icon = KIND_ICON[svc.kind] ?? Layers;
  const latRatio = m.p99 / svc.baseline.p99;
  const primary =
    metric === "latency"
      ? { label: "p99", value: formatMs(m.p99), hot: latRatio >= 1.9 }
      : metric === "errors"
        ? { label: "errors", value: formatPct(m.errorRate), hot: m.errorRate >= 1 }
        : { label: svc.unit, value: formatCompact(m.rps), hot: m.rps < svc.baseline.rps * 0.5 };

  return (
    <div
      className={cn(
        "group relative w-[226px] rounded-[10px] bg-[#0d121c]/95 ring-1 backdrop-blur transition-[opacity,box-shadow,transform] duration-300",
        STATUS_RING[status],
        selected && "ring-2 ring-intel shadow-[0_0_0_4px_rgb(139_124_246/0.18),0_18px_40px_-12px_rgb(0_0_0/0.8)]",
        !selected && status === "critical" && "shadow-[0_0_28px_-6px_rgb(244_63_94/0.55)]",
        !selected && status === "degraded" && "shadow-[0_0_22px_-8px_rgb(251_191_36/0.4)]",
        dim && "opacity-30"
      )}
    >
      {status === "critical" && !dim && <span className="pointer-events-none absolute -inset-1 animate-pulse rounded-[13px] ring-1 ring-critical/40" />}
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-ink-faint" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-ink-faint" />
      <div className="flex items-center gap-2.5 px-3 pb-2 pt-2.5">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] ring-1", status === "healthy" ? "bg-signal/10 ring-signal/25" : status === "degraded" ? "bg-warning/10 ring-warning/30" : "bg-critical/12 ring-critical/35")}>
          <Icon className={cn("h-3.5 w-3.5", status === "healthy" ? "text-signal" : status === "degraded" ? "text-warning" : "text-[#ff7389]")} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[12px] font-medium text-ink">{svc.id}</p>
          <p className="truncate text-[10.5px] text-ink-subtle">{svc.team}</p>
        </div>
        <div className="text-right">
          <p className={cn("tabular text-[13px] font-semibold leading-none", primary.hot ? (status === "critical" ? "text-[#ff7389]" : "text-warning") : "text-ink")}>{primary.value}</p>
          <p className="mt-0.5 text-[9.5px] text-ink-subtle">{primary.label}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-hairline text-center">
        {[
          { l: svc.unit, v: formatCompact(m.rps) },
          { l: "err", v: formatPct(m.errorRate), hot: m.errorRate >= 1 },
          { l: "p99", v: formatMs(m.p99), hot: latRatio >= 1.9 },
        ].map((x, i) => (
          <div key={x.l} className={cn("px-1 py-1.5", i < 2 && "border-r border-hairline")}>
            <p className={cn("tabular text-[11px]", x.hot ? "text-[#ffb4c0]" : "text-ink-muted")}>{x.v}</p>
            <p className="text-[9px] text-ink-faint">{x.l}</p>
          </div>
        ))}
      </div>
      <div className="h-[3px] overflow-hidden rounded-b-[10px] bg-white/[0.04]" title={`CPU ${m.cpu.toFixed(0)}%`}>
        <div className={cn("h-full transition-[width] duration-700", m.cpu > 85 ? "bg-critical" : m.cpu > 70 ? "bg-warning" : "bg-signal/60")} style={{ width: `${m.cpu}%` }} />
      </div>
      {incidents > 0 && (
        <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-bold text-white ring-2 ring-midnight" title={`${incidents} active incident(s)`}>
          {incidents}
        </span>
      )}
      {hop !== undefined && hop > 0 && (
        <span className="absolute -left-2 -top-2 rounded-full bg-intel px-1.5 py-0.5 text-[9.5px] font-semibold text-white ring-2 ring-midnight">{hop} hop{hop > 1 ? "s" : ""}</span>
      )}
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeImpl);
