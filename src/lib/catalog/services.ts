import type { ServiceDef } from "@/lib/types";

/**
 * The imaginary "Acme Cloud" production estate Sentinel watches.
 * `dependencies` are outbound calls: api-gateway → orders-service means the gateway calls orders.
 */
export const SERVICES: ServiceDef[] = [
  {
    id: "edge-cdn",
    name: "edge-cdn",
    kind: "edge",
    tier: "critical",
    team: "Edge Platform",
    runtime: "Envoy 1.31",
    version: "2024.11.3",
    region: "global",
    replicas: 48,
    description: "Global edge: TLS termination, caching and WAF for api.acme.io and app.acme.io.",
    dependencies: ["api-gateway"],
    baseline: { rps: 9800, p50: 8, p95: 22, p99: 45, errorRate: 0.02, cpu: 31, mem: 42 },
    unit: "req/s",
    slo: { availability: 99.99, latencyP99: 120 },
    position: { x: 0, y: 330 },
  },
  {
    id: "api-gateway",
    name: "api-gateway",
    kind: "gateway",
    tier: "critical",
    team: "Platform",
    runtime: "Go 1.23",
    version: "v8.4.1",
    region: "us-east-1 · eu-west-1",
    replicas: 24,
    description: "Public API gateway: routing, authn handoff, rate limiting and request shaping.",
    dependencies: ["auth-service", "user-service", "orders-service", "search-service", "payments-service"],
    baseline: { rps: 4200, p50: 38, p95: 96, p99: 180, errorRate: 0.08, cpu: 46, mem: 51 },
    unit: "req/s",
    slo: { availability: 99.95, latencyP99: 400 },
    position: { x: 300, y: 330 },
  },
  {
    id: "auth-service",
    name: "auth-service",
    kind: "service",
    tier: "critical",
    team: "Identity",
    runtime: "Go 1.23",
    version: "v5.2.0",
    region: "us-east-1 · eu-west-1",
    replicas: 12,
    description: "Sessions, OAuth/OIDC federation and token issuance.",
    dependencies: ["redis-cache", "postgres-primary"],
    baseline: { rps: 1800, p50: 12, p95: 34, p99: 70, errorRate: 0.05, cpu: 38, mem: 47 },
    unit: "req/s",
    slo: { availability: 99.95, latencyP99: 200 },
    position: { x: 620, y: 20 },
  },
  {
    id: "user-service",
    name: "user-service",
    kind: "service",
    tier: "high",
    team: "Accounts",
    runtime: "Node 22",
    version: "v3.11.4",
    region: "us-east-1",
    replicas: 10,
    description: "Profiles, preferences and account settings.",
    dependencies: ["postgres-primary", "redis-cache"],
    baseline: { rps: 1100, p50: 18, p95: 48, p99: 95, errorRate: 0.06, cpu: 33, mem: 55 },
    unit: "req/s",
    slo: { availability: 99.9, latencyP99: 250 },
    position: { x: 620, y: 175 },
  },
  {
    id: "orders-service",
    name: "orders-service",
    kind: "service",
    tier: "critical",
    team: "Commerce",
    runtime: "Java 21 · Spring",
    version: "v3.9.1",
    region: "us-east-1",
    replicas: 16,
    description: "Cart, checkout orchestration and order lifecycle.",
    dependencies: ["postgres-primary", "inventory-service", "payments-service", "kafka-events"],
    baseline: { rps: 640, p50: 52, p95: 140, p99: 260, errorRate: 0.1, cpu: 44, mem: 58 },
    unit: "req/s",
    slo: { availability: 99.95, latencyP99: 600 },
    position: { x: 620, y: 330 },
  },
  {
    id: "search-service",
    name: "search-service",
    kind: "service",
    tier: "high",
    team: "Discovery",
    runtime: "Java 21",
    version: "v2.30.2",
    region: "us-east-1 · eu-west-1",
    replicas: 14,
    description: "Product search, autocomplete and ranking.",
    dependencies: ["search-index", "redis-cache"],
    baseline: { rps: 1350, p50: 34, p95: 88, p99: 170, errorRate: 0.09, cpu: 52, mem: 61 },
    unit: "req/s",
    slo: { availability: 99.9, latencyP99: 400 },
    position: { x: 620, y: 640 },
  },
  {
    id: "payments-service",
    name: "payments-service",
    kind: "service",
    tier: "critical",
    team: "Payments",
    runtime: "Go 1.23",
    version: "v4.17.3",
    region: "us-east-1",
    replicas: 8,
    description: "Charges, refunds and processor routing (PCI scope).",
    dependencies: ["postgres-primary", "kafka-events"],
    baseline: { rps: 210, p50: 85, p95: 210, p99: 380, errorRate: 0.07, cpu: 36, mem: 49 },
    unit: "req/s",
    slo: { availability: 99.99, latencyP99: 900 },
    position: { x: 940, y: 250 },
  },
  {
    id: "inventory-service",
    name: "inventory-service",
    kind: "service",
    tier: "high",
    team: "Commerce",
    runtime: "Kotlin · Ktor",
    version: "v1.22.0",
    region: "us-east-1",
    replicas: 8,
    description: "Stock levels, reservations and warehouse sync.",
    dependencies: ["postgres-primary", "redis-cache"],
    baseline: { rps: 520, p50: 24, p95: 66, p99: 130, errorRate: 0.05, cpu: 29, mem: 44 },
    unit: "req/s",
    slo: { availability: 99.9, latencyP99: 300 },
    position: { x: 940, y: 410 },
  },
  {
    id: "notification-service",
    name: "notification-service",
    kind: "service",
    tier: "standard",
    team: "Engagement",
    runtime: "Python 3.12",
    version: "v6.3.0",
    region: "us-east-1",
    replicas: 6,
    description: "Consumes order events and sends email, push and SMS.",
    dependencies: ["kafka-events"],
    baseline: { rps: 160, p50: 40, p95: 120, p99: 240, errorRate: 0.12, cpu: 22, mem: 39 },
    unit: "msg/s",
    slo: { availability: 99.5, latencyP99: 2000 },
    position: { x: 940, y: 560 },
  },
  {
    id: "postgres-primary",
    name: "postgres-primary",
    kind: "database",
    tier: "critical",
    team: "Data Platform",
    runtime: "PostgreSQL 16",
    version: "16.4",
    region: "us-east-1",
    replicas: 3,
    description: "Primary OLTP cluster (1 writer, 2 readers) behind PgBouncer.",
    dependencies: [],
    baseline: { rps: 5200, p50: 2.1, p95: 7, p99: 18, errorRate: 0.01, cpu: 48, mem: 71 },
    unit: "qps",
    slo: { availability: 99.99, latencyP99: 60 },
    position: { x: 1260, y: 150 },
  },
  {
    id: "redis-cache",
    name: "redis-cache",
    kind: "cache",
    tier: "critical",
    team: "Data Platform",
    runtime: "Redis 7.2",
    version: "7.2.5",
    region: "us-east-1",
    replicas: 6,
    description: "Session store and read-through cache (cluster mode, 3 shards).",
    dependencies: [],
    baseline: { rps: 14500, p50: 0.4, p95: 1.2, p99: 3.1, errorRate: 0.005, cpu: 27, mem: 66 },
    unit: "ops/s",
    slo: { availability: 99.99, latencyP99: 10 },
    position: { x: 1260, y: 310 },
  },
  {
    id: "kafka-events",
    name: "kafka-events",
    kind: "queue",
    tier: "high",
    team: "Data Platform",
    runtime: "Kafka 3.8",
    version: "3.8.0",
    region: "us-east-1",
    replicas: 5,
    description: "Event backbone: order, payment and notification topics.",
    dependencies: [],
    baseline: { rps: 3100, p50: 4, p95: 11, p99: 26, errorRate: 0.01, cpu: 41, mem: 63 },
    unit: "msg/s",
    slo: { availability: 99.95, latencyP99: 100 },
    position: { x: 1260, y: 470 },
  },
  {
    id: "search-index",
    name: "search-index",
    kind: "search",
    tier: "high",
    team: "Discovery",
    runtime: "OpenSearch 2.15",
    version: "2.15.0",
    region: "us-east-1",
    replicas: 9,
    description: "Product catalogue index (products-v7, 12 shards).",
    dependencies: [],
    baseline: { rps: 2100, p50: 14, p95: 40, p99: 90, errorRate: 0.02, cpu: 57, mem: 74 },
    unit: "qps",
    slo: { availability: 99.9, latencyP99: 300 },
    position: { x: 1260, y: 640 },
  },
];

export const SERVICE_MAP: Record<string, ServiceDef> = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
export const SERVICE_INDEX: Record<string, number> = Object.fromEntries(SERVICES.map((s, i) => [s.id, i]));

export function getService(id: string): ServiceDef | undefined {
  return SERVICE_MAP[id];
}

/** reverse edges: who calls `id` */
export const CALLERS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = Object.fromEntries(SERVICES.map((s) => [s.id, [] as string[]]));
  for (const s of SERVICES) for (const d of s.dependencies) out[d]!.push(s.id);
  return out;
})();

/** BFS outward along callers: services that (transitively) depend on `origin`, with hop distance. */
export function upstreamOf(origin: string, maxHops = 3): Map<string, number> {
  const dist = new Map<string, number>([[origin, 0]]);
  const queue = [origin];
  while (queue.length) {
    const cur = queue.shift()!;
    const h = dist.get(cur)!;
    if (h >= maxHops) continue;
    for (const c of CALLERS[cur] ?? []) {
      if (!dist.has(c)) {
        dist.set(c, h + 1);
        queue.push(c);
      }
    }
  }
  return dist;
}

/** services `origin` calls, transitively, with hop distance */
export function downstreamOf(origin: string, maxHops = 3): Map<string, number> {
  const dist = new Map<string, number>([[origin, 0]]);
  const queue = [origin];
  while (queue.length) {
    const cur = queue.shift()!;
    const h = dist.get(cur)!;
    if (h >= maxHops) continue;
    for (const d of SERVICE_MAP[cur]?.dependencies ?? []) {
      if (!dist.has(d)) {
        dist.set(d, h + 1);
        queue.push(d);
      }
    }
  }
  return dist;
}

/** shortest call path from `from` down to `to` (inclusive), or null */
export function callPath(from: string, to: string): string[] | null {
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const d of SERVICE_MAP[cur]?.dependencies ?? []) {
      if (!prev.has(d)) {
        prev.set(d, cur);
        queue.push(d);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path: string[] = [];
  let cur: string | null = to;
  while (cur) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }
  return path;
}

export const PEOPLE = [
  { name: "Priya Raman", team: "Data Platform" },
  { name: "Marcus Chen", team: "Payments" },
  { name: "Elena Volkova", team: "Platform" },
  { name: "Dev Patel", team: "Commerce" },
  { name: "Sofia Alvarez", team: "Identity" },
  { name: "Kenji Watanabe", team: "Discovery" },
  { name: "Amara Okafor", team: "Edge Platform" },
  { name: "Liam O'Brien", team: "Engagement" },
];

export function ownerFor(serviceId: string): string {
  const team = SERVICE_MAP[serviceId]?.team;
  return PEOPLE.find((p) => p.team === team)?.name ?? "Elena Volkova";
}
