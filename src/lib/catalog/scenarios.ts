import type { ChangeKind, LogLevel, Severity } from "@/lib/types";

/**
 * Failure scenarios the SIMULATOR can play out. Each one shapes metrics (via an effect
 * signature that propagates up the call graph) and emits realistic log lines.
 *
 * These are ground truth for the synthetic world only. The intelligence engine has its
 * own, independent knowledge base (lib/intelligence/knowledge.ts) and must recognise
 * the failure from the evidence these scenarios leave behind.
 */

export interface Effect {
  /** multiplicative latency increase at full intensity (2 = +200%) */
  latency: number;
  /** additive error-rate in percentage points */
  errors: number;
  /** multiplicative traffic change (-0.3 = 30% drop, 0.5 = retries +50%) */
  traffic?: number;
  /** additive cpu percentage points */
  cpu?: number;
  /** additive memory percentage points */
  mem?: number;
  /** call-graph distance from the origin (set by the propagation model) */
  hop?: number;
}

export interface LogTemplate {
  /** "origin", "callers" (hop-1 callers), or an explicit service id */
  target: string;
  level: LogLevel;
  text: string;
  /** expected lines per 10s per target service at full intensity */
  rate: number;
  /** also emit a correlated api-gateway line sharing the trace id */
  gateway?: boolean;
}

export interface Scenario {
  id: string;
  origin: string;
  severity: Severity;
  titles: string[];
  description: string;
  signature: {
    origin: Effect;
    callers?: Effect;
    overrides?: Record<string, Effect>;
    downstreamTraffic?: number;
    memGrowth?: boolean;
  };
  logs: LogTemplate[];
  change?: { kind: ChangeKind; service?: string; leadMin: [number, number]; summary: string; version?: string };
  notes: { investigating: string; identified: string; action: string; resolution: string };
  tags: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "db-pool-exhaustion",
    origin: "postgres-primary",
    severity: "SEV-2",
    titles: ["Elevated checkout errors: orders-service timing out on database", "Checkout latency and 5xx spike across commerce APIs"],
    description:
      "Customers report checkout spinning and failing intermittently. orders-service and payments-service p99 latency climbed sharply and 5xx responses are rising at the gateway.",
    signature: {
      origin: { latency: 4.2, errors: 0.25, cpu: 36 },
      callers: { latency: 1.5, errors: 1.4, traffic: 0.06 },
      overrides: {
        "orders-service": { latency: 2.6, errors: 4.6, traffic: 0.12 },
        "payments-service": { latency: 2.1, errors: 3.2 },
      },
    },
    logs: [
      { target: "orders-service", level: "ERROR", text: "HikariPool-1 - Connection is not available, request timed out after {ms}ms (total=64, active=64, idle=0, waiting={n})", rate: 3.2, gateway: true },
      { target: "payments-service", level: "ERROR", text: "pq: sorry, too many clients already (pool=payments-rw, wait={ms}ms)", rate: 1.6, gateway: true },
      { target: "user-service", level: "WARN", text: "db query exceeded 1000ms budget: SELECT * FROM accounts WHERE id = $1 ({ms}ms)", rate: 0.9 },
      { target: "origin", level: "WARN", text: "connection slots nearly exhausted: {n2}/500 in use (role=orders_rw)", rate: 0.8 },
      { target: "origin", level: "FATAL", text: "remaining connection slots are reserved for non-replication superuser connections", rate: 0.35 },
    ],
    change: { kind: "deploy", service: "orders-service", leadMin: [9, 13], summary: "Increase checkout worker threads 32 → 64", version: "v3.9.2" },
    notes: {
      investigating: "orders-service is throwing HikariPool timeouts. Checking connection counts on the primary.",
      identified: "Primary is at its max_connections ceiling. orders-service v3.9.2 doubled worker threads, and each one holds a pooled connection.",
      action: "Rolled orders-service back to v3.9.1 and raised the PgBouncer pool from 400 to 600 as a stopgap.",
      resolution: "Connection usage back under 60%. Checkout success rate has recovered to baseline.",
    },
    tags: ["database", "checkout", "capacity"],
  },
  {
    id: "bad-deploy",
    origin: "payments-service",
    severity: "SEV-1",
    titles: ["Payments returning 500s after release", "Card charges failing at checkout"],
    description:
      "A sharp rise in HTTP 500 responses on POST /v1/charges. Checkout conversion has dropped and support is receiving reports of declined cards that should have succeeded.",
    signature: {
      origin: { latency: 0.5, errors: 13.5, cpu: 10 },
      callers: { latency: 0.35, errors: 4.6 },
    },
    logs: [
      { target: "origin", level: "ERROR", text: "panic: runtime error: invalid memory address or nil pointer dereference [recovered] handler=/v1/charges build={version}", rate: 3.4, gateway: true },
      { target: "origin", level: "ERROR", text: "POST /v1/charges 500: failed to decode PaymentIntent: unknown field \"capture_strategy\"", rate: 2.2, gateway: true },
      { target: "orders-service", level: "ERROR", text: "payment authorization failed for order ord_{key}: upstream payments-service returned 500", rate: 1.8 },
    ],
    change: { kind: "deploy", leadMin: [4, 7], summary: "Introduce capture_strategy for delayed capture", version: "v4.18.0" },
    notes: {
      investigating: "500s started right after the payments v4.18.0 rollout reached 100%. Nil pointer panics are in the charges handler.",
      identified: "v4.18.0 assumes capture_strategy is always present. Older clients omit it and the handler panics.",
      action: "Rolled payments-service back to v4.17.3. Canary analysis is now required for the payments pipeline.",
      resolution: "Error rate back to baseline 4 minutes after the rollback completed. Affected orders are being replayed.",
    },
    tags: ["deploy", "payments", "regression"],
  },
  {
    id: "cache-stampede",
    origin: "redis-cache",
    severity: "SEV-2",
    titles: ["Login and profile latency spike: cache hit ratio collapse", "Sign-in and account pages slow"],
    description:
      "Login, profile and search pages slowed down at the same time. Several services report cache timeouts, and database read load jumped.",
    signature: {
      origin: { latency: 3.4, errors: 0.6, cpu: 44, mem: 25 },
      callers: { latency: 1.7, errors: 1.3, traffic: 0.08 },
    },
    logs: [
      { target: "origin", level: "WARN", text: "evicted {n} keys in last 10s (maxmemory-policy=allkeys-lru, used_memory=99.{p}%)", rate: 1.2 },
      { target: "callers", level: "WARN", text: "cache hit ratio dropped to {pct}% for keyspace session:*", rate: 0.7 },
      { target: "callers", level: "ERROR", text: "redis: i/o timeout after {ms}ms (pool=cache-primary, shard={p})", rate: 1.1, gateway: true },
    ],
    change: { kind: "config", service: "redis-cache", leadMin: [15, 22], summary: "Reduce maxmemory 12gb → 8gb to free node headroom" },
    notes: {
      investigating: "Cache timeouts are showing up in auth, user and search at the same time. Looking at redis memory.",
      identified: "Redis is at maxmemory and evicting hot session keys. Each eviction triggers a read-through miss storm on Postgres.",
      action: "Restored maxmemory to 12gb and pre-warmed the session keyspace.",
      resolution: "Hit ratio is back above 96%. Latency normal across callers.",
    },
    tags: ["cache", "latency"],
  },
  {
    id: "kafka-consumer-lag",
    origin: "kafka-events",
    severity: "SEV-3",
    titles: ["Order confirmation emails delayed: event pipeline lag", "Notifications delayed by several minutes"],
    description:
      "Order confirmation emails are arriving 5–15 minutes late. The notifications consumer group is falling behind on order.events.",
    signature: {
      origin: { latency: 2.1, errors: 0.15, cpu: 30 },
      callers: { latency: 0.5, errors: 0.08 },
      overrides: { "notification-service": { latency: 4.2, errors: 1.4, traffic: -0.35 } },
    },
    logs: [
      { target: "notification-service", level: "WARN", text: "consumer group notifications-v2 lag {n} messages on topic order.events (partition {p})", rate: 1.6 },
      { target: "origin", level: "WARN", text: "ISR shrink for partition order.events-{p}: broker 3 fell out of sync (replica.lag.time.max.ms exceeded)", rate: 0.6 },
      { target: "orders-service", level: "WARN", text: "kafka produce latency {ms}ms exceeds 500ms budget (topic=order.events)", rate: 0.5 },
      { target: "notification-service", level: "ERROR", text: "rebalance in progress: commit failed for offset {n} on order.events-{p}", rate: 0.4 },
    ],
    change: { kind: "infra", service: "kafka-events", leadMin: [18, 26], summary: "Broker 3 replaced (disk upgrade gp2 → gp3)" },
    notes: {
      investigating: "notifications-v2 consumer lag is climbing on order.events. Producer latency on orders is also elevated.",
      identified: "Broker 3 is still catching up after replacement. The ISR shrink is triggering repeated consumer rebalances.",
      action: "Throttled partition reassignment and raised session.timeout.ms on the consumer group.",
      resolution: "Consumer lag drained. Email delivery latency back under 30s.",
    },
    tags: ["kafka", "async", "notifications"],
  },
  {
    id: "tls-cert-expiry",
    origin: "edge-cdn",
    severity: "SEV-1",
    titles: ["Customers unable to reach api.acme.io: TLS handshake failures", "Mobile apps failing to connect"],
    description:
      "Mobile apps and API clients are failing to connect. Browsers show certificate warnings on api.acme.io. Backend traffic dropped suddenly.",
    signature: {
      origin: { latency: 0.4, errors: 9.5, traffic: -0.12 },
      downstreamTraffic: -0.38,
    },
    logs: [
      { target: "origin", level: "ERROR", text: "TLS handshake failed for api.acme.io: x509: certificate has expired or is not yet valid (notAfter={date})", rate: 4.5 },
      { target: "origin", level: "WARN", text: "client hello rejected: certificate chain for *.acme.io expired {n}s ago", rate: 1.5 },
    ],
    change: { kind: "infra", service: "edge-cdn", leadMin: [35, 55], summary: "cert-manager renewal for *.acme.io failed (ACME rate limit)" },
    notes: {
      investigating: "Handshake failures across every edge POP. The certificate for *.acme.io shows notAfter in the past.",
      identified: "Automated renewal failed 9 days ago on an ACME rate limit. The alert went to a decommissioned channel.",
      action: "Issued a replacement certificate from the backup CA and pushed it to all POPs.",
      resolution: "Handshakes succeeding globally. Traffic back to expected levels.",
    },
    tags: ["edge", "tls", "availability"],
  },
  {
    id: "memory-leak",
    origin: "search-service",
    severity: "SEV-3",
    titles: ["Search degraded: pods restarting under memory pressure", "Intermittent search timeouts"],
    description:
      "Search requests are intermittently timing out, and search-service pods are restarting in a rolling pattern.",
    signature: {
      origin: { latency: 1.7, errors: 2.6, mem: 30, cpu: 16 },
      callers: { latency: 0.8, errors: 1.0 },
      memGrowth: true,
    },
    logs: [
      { target: "origin", level: "WARN", text: "heap usage {pct}% exceeds 85% threshold (G1 old gen)", rate: 1.0 },
      { target: "origin", level: "WARN", text: "GC pause {ms}ms (G1 Evacuation Pause, heap {pct}% of limit)", rate: 0.9 },
      { target: "origin", level: "ERROR", text: "container search-service-{pod} OOMKilled (limit 4Gi), restart count {n2}", rate: 0.45, gateway: true },
    ],
    change: { kind: "deploy", leadMin: [80, 110], summary: "Add query embedding cache for semantic ranking", version: "v2.31.0" },
    notes: {
      investigating: "search-service pods are OOMKilled every few minutes. Heap climbs steadily after each restart.",
      identified: "The new embedding cache in v2.31.0 has no eviction bound and grows with distinct queries.",
      action: "Capped the embedding cache at 50k entries via a feature flag and raised the memory limit to 6Gi.",
      resolution: "Heap stable at 62%. No OOMKills in the last 30 minutes.",
    },
    tags: ["memory", "search"],
  },
  {
    id: "rate-limit-misconfig",
    origin: "api-gateway",
    severity: "SEV-2",
    titles: ["Spike in 429s across public API", "Partners hitting rate limits on the public API"],
    description:
      "Partners and the web app are receiving HTTP 429 Too Many Requests at normal traffic levels. Downstream services see a sudden traffic drop.",
    signature: {
      origin: { latency: 0.2, errors: 7.2 },
      downstreamTraffic: -0.3,
    },
    logs: [
      { target: "origin", level: "WARN", text: "429 Too Many Requests: tenant {tenant} exceeded limit 20 rps (policy=tenant-default, burst=20)", rate: 4.2 },
      { target: "origin", level: "ERROR", text: "rate limiter rejected {n} requests in 10s window (policy=tenant-default)", rate: 0.8 },
    ],
    change: { kind: "config", leadMin: [2, 4], summary: "rate-limit policy tenant-default updated: burst 200 → 20" },
    notes: {
      investigating: "429s jumped right after a config push. Every tenant on the default policy is affected.",
      identified: "The burst limit was set to 20 instead of 200. A missing zero in the policy change.",
      action: "Reverted the tenant-default policy to burst=200 and added schema validation to the policy repo.",
      resolution: "429 rate back to baseline. Partners confirmed recovery.",
    },
    tags: ["gateway", "config"],
  },
  {
    id: "idp-latency",
    origin: "auth-service",
    severity: "SEV-2",
    titles: ["Sign-in slow and intermittently failing", "SSO logins timing out"],
    description:
      "Users report sign-in taking 10+ seconds or failing with a generic error. SSO customers are most affected.",
    signature: {
      origin: { latency: 3.0, errors: 3.1 },
      callers: { latency: 1.4, errors: 1.5 },
    },
    logs: [
      { target: "origin", level: "ERROR", text: "OIDC discovery request to login.idp-partner.com timed out after {ms}ms", rate: 2.0, gateway: true },
      { target: "origin", level: "WARN", text: "JWKS refresh failed; serving cached keys (age {n2}s)", rate: 0.8 },
      { target: "api-gateway", level: "WARN", text: "auth-service p99 {ms}ms exceeds route budget 800ms (route=/v1/session)", rate: 0.6 },
    ],
    notes: {
      investigating: "Timeouts to the identity partner's discovery endpoint. Our own auth paths look healthy.",
      identified: "Partner IdP is degraded in us-east. Their status page now confirms it.",
      action: "Enabled cached discovery documents with a 15 minute TTL and shortened the OIDC timeout to 2s with fallback.",
      resolution: "Partner recovered. Sign-in latency back to normal.",
    },
    tags: ["auth", "third-party"],
  },
  {
    id: "search-slow-queries",
    origin: "search-index",
    severity: "SEV-4",
    titles: ["Product search returning partial results", "Slow queries on products index"],
    description:
      "Some product searches return incomplete results. search-index reports slow queries concentrated on a single shard.",
    signature: {
      origin: { latency: 2.6, errors: 0.5, cpu: 28 },
      callers: { latency: 1.5, errors: 0.7 },
    },
    logs: [
      { target: "origin", level: "WARN", text: "[index:products-v7][shard 3] slow query took {ms}ms (threshold 500ms)", rate: 1.5 },
      { target: "origin", level: "WARN", text: "circuit_breaking_exception: [parent] Data too large, would be [{n2}mb] (limit 3.8gb)", rate: 0.4 },
      { target: "search-service", level: "WARN", text: "search query timeout, returning partial results (shards 11/12)", rate: 0.9 },
    ],
    change: { kind: "infra", service: "search-index", leadMin: [25, 40], summary: "Reindex products-v7 after a catalogue import of 1.2M SKUs" },
    notes: {
      investigating: "Slow queries all hit shard 3 of products-v7. The other shards look normal.",
      identified: "Shard 3 is hot after the bulk import. Uneven routing keys put 31% of documents on one shard.",
      action: "Relocated shard 3 replicas to dedicated nodes and throttled background merges.",
      resolution: "Query latency is back under threshold. Partial-results rate is zero.",
    },
    tags: ["search", "performance"],
  },
  {
    id: "inventory-lock-contention",
    origin: "inventory-service",
    severity: "SEV-2",
    titles: ["Checkout failing during flash sale: stock reservation errors", "Add-to-cart failures on sale items"],
    description:
      "During the flash sale, checkout fails for popular items with \"item no longer available\" even though stock exists.",
    signature: {
      origin: { latency: 3.3, errors: 3.9, cpu: 18 },
      callers: { latency: 1.3, errors: 2.0 },
    },
    logs: [
      { target: "origin", level: "ERROR", text: "deadlock detected while updating stock_levels (sku={sku}), retrying ({n2}/3)", rate: 1.6 },
      { target: "origin", level: "WARN", text: "lock wait timeout exceeded on stock_levels row lock ({ms}ms)", rate: 1.2 },
      { target: "orders-service", level: "ERROR", text: "reserve-stock call to inventory-service failed: 409 conflict after 3 retries (sku={sku})", rate: 1.4, gateway: true },
    ],
    change: { kind: "flag", service: "inventory-service", leadMin: [6, 10], summary: "Feature flag flash-sale-mode enabled (100%)" },
    notes: {
      investigating: "Reservation conflicts are concentrated on about 40 hot SKUs from the flash sale.",
      identified: "Row-level locks on stock_levels serialise every reservation for a hot SKU. Retries amplify the contention.",
      action: "Switched hot SKUs to the sharded counter path and reduced client retries from 3 to 1 with jitter.",
      resolution: "Reservation success rate back to 99.8%.",
    },
    tags: ["checkout", "database", "contention"],
  },
];

export const SCENARIO_MAP: Record<string, Scenario> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
