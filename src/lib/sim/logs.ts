import { SERVICES, SERVICE_INDEX, SERVICE_MAP, CALLERS } from "@/lib/catalog/services";
import { SCENARIO_MAP, type Scenario } from "@/lib/catalog/scenarios";
import type { Incident, LogEntry, LogLevel, ServiceDef } from "@/lib/types";
import { HOP_DELAY_MS, diurnal, impactMap, incidentIntensity } from "./telemetry";
import { hash, hex, pick, poisson, rand } from "./random";

/*
 * Structured log generator. Deterministic per (service, 10s bucket, line), so the same
 * window always yields the same lines, and live tail simply reveals new buckets.
 * Incident lines are emitted with the failure signature of the scenario being played,
 * at a rate proportional to the incident's live intensity, so logs correlate with metrics.
 */

const BUCKET = 10_000;

type Tpl = { level: LogLevel; text: string; w: number };

const ROUTES: { method: string; route: string; service: string }[] = [
  { method: "GET", route: "/v1/session", service: "auth-service" },
  { method: "POST", route: "/v1/session/refresh", service: "auth-service" },
  { method: "GET", route: "/v2/users/me", service: "user-service" },
  { method: "PATCH", route: "/v2/users/me/preferences", service: "user-service" },
  { method: "POST", route: "/v2/orders", service: "orders-service" },
  { method: "GET", route: "/v2/orders/:id", service: "orders-service" },
  { method: "GET", route: "/v2/search", service: "search-service" },
  { method: "GET", route: "/v2/search/suggest", service: "search-service" },
  { method: "POST", route: "/v1/charges", service: "payments-service" },
];

const QUERIES = ["running shoes", "wireless earbuds", "standing desk", "espresso grinder", "rain jacket", "4k monitor", "yoga mat", "mechanical keyboard"];
const POPS = ["iad3", "fra1", "sin2", "gru1", "bom1", "sfo2", "lhr4", "nrt1"];
const TENANTS = ["globex", "initech", "umbrella-retail", "stark-mobile", "wayne-logistics", "hooli"];

const NORMAL: Record<string, Tpl[]> = {
  "edge-cdn": [
    { level: "INFO", text: "cache HIT /assets/app.{key}.js {ms}ms pop={pop}", w: 5 },
    { level: "INFO", text: "cache MISS /v2/catalog/featured, origin fetch {ms}ms pop={pop}", w: 2 },
    { level: "DEBUG", text: "WAF rule 942100 evaluated: pass (score 0)", w: 1 },
    { level: "INFO", text: "TLS 1.3 session resumed pop={pop} cipher=TLS_AES_128_GCM_SHA256", w: 2 },
  ],
  "auth-service": [
    { level: "INFO", text: "token issued for u_{key} (grant=refresh_token, ttl=900s)", w: 4 },
    { level: "INFO", text: "session validated for u_{key} (cache hit)", w: 4 },
    { level: "DEBUG", text: "jwks cache hit (kid=k-2026-11)", w: 2 },
    { level: "WARN", text: "invalid credentials for u_{key} (attempt {n2}/5)", w: 0.15 },
  ],
  "user-service": [
    { level: "INFO", text: "GET /users/u_{key} served in {ms}ms", w: 4 },
    { level: "INFO", text: "preferences updated for u_{key}", w: 1 },
    { level: "DEBUG", text: "cache read user:u_{key} hit", w: 2 },
  ],
  "orders-service": [
    { level: "INFO", text: "order ord_{key} created (items={n2}, total=${amount})", w: 3 },
    { level: "INFO", text: "checkout session cs_{key} started", w: 2 },
    { level: "INFO", text: "order ord_{key} transitioned PAID → FULFILLING", w: 2 },
    { level: "DEBUG", text: "HikariPool-1 stats (total=32, active={n2}, idle={n2}, waiting=0)", w: 1 },
  ],
  "payments-service": [
    { level: "INFO", text: "charge ch_{key} authorized ({amount} USD, processor=adyen)", w: 4 },
    { level: "INFO", text: "refund re_{key} settled ({amount} USD)", w: 0.6 },
    { level: "DEBUG", text: "idempotency key hit for ch_{key}", w: 1 },
  ],
  "inventory-service": [
    { level: "INFO", text: "reserved {n2} units of sku={sku}", w: 4 },
    { level: "INFO", text: "warehouse sync batch {n} applied ({n2} SKUs)", w: 1 },
    { level: "DEBUG", text: "stock cache refreshed for sku={sku}", w: 1 },
  ],
  "search-service": [
    { level: "INFO", text: "query \"{q}\" returned {n} hits in {ms}ms", w: 5 },
    { level: "INFO", text: "autocomplete \"{qp}\" served from cache", w: 2 },
    { level: "DEBUG", text: "ranking model v14 scored {n} docs", w: 1 },
  ],
  "notification-service": [
    { level: "INFO", text: "email order_confirmation sent to u_{key} via ses ({ms}ms)", w: 4 },
    { level: "INFO", text: "push delivered to device d_{key}", w: 2 },
    { level: "DEBUG", text: "consumed batch of {n2} from order.events-{p}", w: 2 },
  ],
  "kafka-events": [
    { level: "INFO", text: "consumer group notifications-v2 committed offset {n} on order.events-{p}", w: 3 },
    { level: "DEBUG", text: "log segment rolled for payment.events-{p}", w: 1 },
    { level: "INFO", text: "partition order.events-{p} leader epoch stable (isr=3)", w: 1 },
  ],
  "postgres-primary": [
    { level: "INFO", text: "checkpoint complete: wrote {n} buffers ({pct}%)", w: 1 },
    { level: "INFO", text: "automatic vacuum of table \"public.orders\": index scans: 1, pages removed {n2}", w: 1 },
    { level: "DEBUG", text: "duration: {ms}ms statement: SELECT id, status FROM orders WHERE customer_id = $1", w: 3 },
  ],
  "redis-cache": [
    { level: "INFO", text: "keyspace hit ratio {pctHigh}% (shard {p})", w: 2 },
    { level: "DEBUG", text: "Accepted 10.42.{p}.{n2}:6379", w: 2 },
    { level: "INFO", text: "background save completed in {ms}ms", w: 0.5 },
  ],
  "search-index": [
    { level: "INFO", text: "[products-v7] refresh completed in {ms}ms", w: 2 },
    { level: "DEBUG", text: "[products-v7][shard {p}] query took {ms}ms", w: 3 },
    { level: "INFO", text: "merged {n2} segments on shard {p}", w: 0.6 },
  ],
};

const NOISE: Tpl[] = [
  { level: "WARN", text: "retrying request to {dep} (attempt 2/3, {ms}ms backoff)", w: 1 },
  { level: "ERROR", text: "request cancelled by client: context canceled after {ms}ms", w: 0.3 },
];

const LOG_RATE: Record<string, number> = {
  "edge-cdn": 1.0,
  "api-gateway": 1.6,
  "auth-service": 0.8,
  "user-service": 0.6,
  "orders-service": 0.8,
  "payments-service": 0.5,
  "inventory-service": 0.5,
  "search-service": 0.8,
  "notification-service": 0.4,
  "kafka-events": 0.4,
  "postgres-primary": 0.4,
  "redis-cache": 0.35,
  "search-index": 0.45,
};

function weighted<T extends { w: number }>(items: T[], r: number): T {
  let total = 0;
  for (const i of items) total += i.w;
  let x = r * total;
  for (const i of items) {
    x -= i.w;
    if (x <= 0) return i;
  }
  return items[items.length - 1]!;
}

function podName(svc: ServiceDef, r: number) {
  const idx = Math.floor(r * Math.min(svc.replicas, 12));
  const h = hash(SERVICE_INDEX[svc.id] ?? 0, idx, 77);
  return `${svc.id}-${hex(h, 5)}-${hex(hash(h, 3), 5)}`;
}

function fill(text: string, seed: number, ctx: { svc: ServiceDef; version?: string; date?: string; slowMs?: boolean }) {
  let i = 0;
  const r = () => rand(seed, ++i);
  return text.replace(/\{(\w+)\}/g, (_, k: string) => {
    switch (k) {
      case "ms":
        return String(Math.round(ctx.slowMs ? 900 + r() * 4100 : 3 + r() * r() * 180));
      case "n":
        return String(Math.round(80 + r() * 4900));
      case "n2":
        return String(Math.round(2 + r() * 46));
      case "pct":
        return (40 + r() * 52).toFixed(1);
      case "pctHigh":
        return (95 + r() * 4.6).toFixed(1);
      case "p":
        return String(Math.floor(r() * 12));
      case "key":
        return hex(hash(seed, i, 9), 8);
      case "sku":
        return `SKU-${Math.floor(10000 + r() * 89999)}`;
      case "amount":
        return (12 + r() * 340).toFixed(2);
      case "pop":
        return pick(POPS, r());
      case "q":
        return pick(QUERIES, r());
      case "qp":
        return pick(QUERIES, r()).slice(0, 4);
      case "tenant":
        return pick(TENANTS, r());
      case "pod":
        return `${hex(hash(seed, 5), 5)}`;
      case "dep":
        return ctx.svc.dependencies.length ? pick(ctx.svc.dependencies, r()) : "upstream";
      case "version":
        return ctx.version ?? ctx.svc.version;
      case "date":
        return ctx.date ?? "2026-01-01T00:00:00Z";
      default:
        return k;
    }
  });
}

function targetsFor(target: string, sc: Scenario): string[] {
  if (target === "origin") return [sc.origin];
  if (target === "callers") return CALLERS[sc.origin] ?? [];
  return [target];
}

export interface LogQuery {
  from: number;
  to: number;
  incidents: Incident[];
  /** target number of baseline lines; larger windows are sampled down */
  budget?: number;
}

export function generateLogs({ from, to, incidents, budget = 3200 }: LogQuery): LogEntry[] {
  const out: LogEntry[] = [];
  const b0 = Math.floor(from / BUCKET);
  const b1 = Math.floor(to / BUCKET);
  const buckets = b1 - b0 + 1;
  const linesPerBucket = 11;
  const density = Math.min(1, budget / (buckets * linesPerBucket));
  const incidentDensity = Math.max(0.2, Math.sqrt(density));

  const live = incidents.filter((inc) => inc.sim && inc.impactStartedAt <= to && (!inc.resolvedAt || inc.resolvedAt + 200_000 >= from));

  for (let b = b0; b <= b1; b++) {
    const bt = b * BUCKET;
    const load = diurnal(bt);

    for (const svc of SERVICES) {
      const si = SERVICE_INDEX[svc.id]!;
      const n = poisson((LOG_RATE[svc.id] ?? 0.5) * load, rand(si, b, 1), rand(si, b, 2));
      for (let k = 0; k < n; k++) {
        const seed = hash(si, b, k, 3);
        if (rand(seed, 0) > density) continue;
        const t = bt + Math.floor(rand(seed, 1) * BUCKET);
        if (t < from || t > to) continue;
        const traceId = hex(hash(seed, 11), 16);
        const host = podName(svc, rand(seed, 2));
        const noise = rand(seed, 3);

        if (svc.id === "api-gateway") {
          const route = pick(ROUTES, rand(seed, 4));
          const ms = Math.round(12 + rand(seed, 5) * rand(seed, 6) * 220);
          const status = noise < 0.004 ? 499 : rand(seed, 7) < 0.04 ? (route.method === "GET" ? 304 : 201) : 200;
          out.push({
            id: `l${seed.toString(36)}`,
            t,
            level: "INFO",
            service: svc.id,
            message: `${route.method} ${route.route} ${status} in ${ms}ms → ${route.service}`,
            traceId,
            spanId: hex(hash(seed, 12), 8),
            host,
            attrs: { "http.method": route.method, "http.route": route.route, "http.status_code": status, duration_ms: ms, upstream: route.service, region: "us-east-1", env: "production" },
          });
          if (rand(seed, 8) < 0.45) {
            const ds = SERVICE_MAP[route.service]!;
            out.push({
              id: `l${seed.toString(36)}d`,
              t: t + Math.max(1, Math.round(ms * 0.2)),
              level: "INFO",
              service: ds.id,
              message: `handled ${route.method} ${route.route} in ${Math.round(ms * 0.7)}ms`,
              traceId,
              spanId: hex(hash(seed, 13), 8),
              host: podName(ds, rand(seed, 9)),
              attrs: { "http.route": route.route, duration_ms: Math.round(ms * 0.7), parent_span: hex(hash(seed, 12), 8), env: "production", version: ds.version },
            });
          }
          continue;
        }

        const tpl = noise < 0.012 ? weighted(NOISE, rand(seed, 4)) : weighted(NORMAL[svc.id] ?? NOISE, rand(seed, 4));
        out.push({
          id: `l${seed.toString(36)}`,
          t,
          level: tpl.level,
          service: svc.id,
          message: fill(tpl.text, seed, { svc }),
          traceId,
          spanId: hex(hash(seed, 12), 8),
          host,
          attrs: { env: "production", region: svc.region.split(" ")[0]!, version: svc.version, runtime: svc.runtime },
        });
      }
    }

    // incident signature lines
    for (const inc of live) {
      const sc = SCENARIO_MAP[inc.sim!.scenarioId];
      if (!sc) continue;
      const topo = impactMap(sc.id);
      if (incidentIntensity(inc, bt + BUCKET / 2) < 0.04) continue;
      const incSeed = hash(b, inc.impactStartedAt % 1_000_000_007);
      sc.logs.forEach((tpl, j) => {
        for (const target of targetsFor(tpl.target, sc)) {
          const svc = SERVICE_MAP[target];
          if (!svc) continue;
          const si = SERVICE_INDEX[target]!;
          const I = incidentIntensity(inc, bt + BUCKET / 2 - (topo.get(target)?.hop ?? 0) * HOP_DELAY_MS);
          if (I < 0.06) continue;
          const count = poisson(tpl.rate * I * incidentDensity, rand(incSeed, si, j, 1), rand(incSeed, si, j, 2));
          for (let k = 0; k < count; k++) {
            const seed = hash(incSeed, si, j, k, 5);
            const t = bt + Math.floor(rand(seed, 1) * BUCKET);
            if (t < from || t > to) continue;
            const traceId = hex(hash(seed, 11), 16);
            const spanId = hex(hash(seed, 12), 8);
            const message = fill(tpl.text, seed, {
              svc,
              version: sc.change?.version,
              date: new Date(inc.impactStartedAt - 3 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z"),
              slowMs: true,
            });
            out.push({
              id: `e${seed.toString(36)}`,
              t,
              level: tpl.level,
              service: target,
              message,
              traceId,
              spanId,
              host: podName(svc, rand(seed, 2)),
              attrs: {
                env: "production",
                region: svc.region.split(" ")[0]!,
                version: target === sc.origin && sc.change?.version && sc.change.kind === "deploy" ? sc.change.version : svc.version,
                "error.kind": tpl.level === "WARN" ? "degradation" : "failure",
              },
              incidentId: inc.id,
            });
            if (tpl.gateway && target !== "api-gateway") {
              const gw = SERVICE_MAP["api-gateway"]!;
              const code = tpl.text.includes("timed out") || tpl.text.includes("timeout") ? 504 : tpl.text.includes("409") ? 409 : tpl.text.includes("too many") ? 503 : 500;
              out.push({
                id: `g${seed.toString(36)}`,
                t: t + 3 + Math.floor(rand(seed, 3) * 60),
                level: "ERROR",
                service: "api-gateway",
                message: `upstream ${target} returned ${code} (${code === 504 ? "upstream request timeout" : "upstream error"}), trace propagated`,
                traceId,
                spanId: hex(hash(seed, 14), 8),
                host: podName(gw, rand(seed, 4)),
                attrs: { "http.status_code": code, upstream: target, parent_span: spanId, env: "production" },
                incidentId: inc.id,
              });
            }
          }
        }
      });
    }
  }

  out.sort((a, b) => b.t - a.t);
  return out;
}

export const LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

export interface HistogramBin {
  t: number;
  end: number;
  DEBUG: number;
  INFO: number;
  WARN: number;
  ERROR: number;
  FATAL: number;
}

export function logHistogram(logs: LogEntry[], from: number, to: number, bins = 60): HistogramBin[] {
  const width = Math.max(1000, (to - from) / bins);
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({
    t: from + i * width,
    end: from + (i + 1) * width,
    DEBUG: 0,
    INFO: 0,
    WARN: 0,
    ERROR: 0,
    FATAL: 0,
  }));
  for (const l of logs) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor((l.t - from) / width)));
    out[i]![l.level]++;
  }
  return out;
}
