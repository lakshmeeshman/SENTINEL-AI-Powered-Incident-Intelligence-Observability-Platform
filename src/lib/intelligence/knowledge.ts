import type { ChangeEvent, Incident, LogSignatureHit, MetricKey, RecommendedAction, ServiceKind } from "@/lib/types";
import { SERVICE_MAP } from "@/lib/catalog/services";
import { formatClock } from "@/lib/utils";

/*
 * Sentinel's failure-mode knowledge base: how each class of failure *looks* in evidence
 * (log signatures, which metric moves first, what kind of component originates it) and
 * the runbook knowledge used to explain it. The engine scores evidence against these.
 */

export interface Facts {
  incident: Incident;
  origin: string;
  callers: string[];
  shadowed: string[];
  onset: number;
  leadSec: number;
  metric: MetricKey;
  ratio: number;
  z: number;
  change?: ChangeEvent;
  changeLeadMin?: number;
  hits: LogSignatureHit[];
  topHit?: LogSignatureHit;
  durationMin: number;
  loadFactor: number;
  resolved: boolean;
}

export interface FailureMode {
  id: string;
  label: string;
  category: string;
  signatures: { id: string; label: string; re: RegExp }[];
  keywords: string[];
  expect: { metric: "latency" | "errors" | "memory" | "traffic"; kinds?: ServiceKind[] };
  /** how far before onset a change can plausibly be the trigger (minutes) */
  changeHorizonMin: number;
  rootCause: (f: Facts) => { title: string; detail: string };
  factors: (f: Facts) => string[];
  immediate: (f: Facts) => RecommendedAction[];
  followUp: (f: Facts) => RecommendedAction[];
  prevention: string[];
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const callersText = (f: Facts) => (f.callers.length ? list(f.callers.slice(0, 3)) : "its clients");
export const changeLabel = (kind: ChangeEvent["kind"]) =>
  kind === "deploy" ? "deploy" : kind === "config" ? "config change" : kind === "flag" ? "feature flag change" : "infrastructure change";
const changeText = (f: Facts) =>
  f.change
    ? `${f.change.kind === "deploy" ? `the ${f.change.service} ${f.change.version ?? ""} deploy` : `${f.change.kind === "infra" ? "an" : "a"} ${changeLabel(f.change.kind)} on ${f.change.service}`} ("${f.change.summary}") ${Math.round(f.changeLeadMin ?? 0)} min before onset`
    : "";

export const FAILURE_MODES: FailureMode[] = [
  {
    id: "db-pool-exhaustion",
    label: "Database connection exhaustion",
    category: "Capacity",
    signatures: [
      { id: "hikari-timeout", label: "Connection pool timeout", re: /Connection is not available|request timed out after/i },
      { id: "pg-too-many", label: "Too many database clients", re: /too many clients|connection slots|reserved for non-replication/i },
      { id: "db-slow", label: "Query budget exceeded", re: /db query exceeded/i },
    ],
    keywords: ["database", "db", "postgres", "connection", "pool", "checkout", "timeout"],
    expect: { metric: "latency", kinds: ["database"] },
    changeHorizonMin: 60,
    rootCause: (f) => ({
      title: `Connection exhaustion on ${f.origin}`,
      detail: `${f.origin} reached its connection ceiling. Clients (${callersText(f)}) queued for pooled connections until they hit their acquisition timeouts, which surfaced as 5xx at the gateway. ${
        f.change ? `The trigger lines up with ${changeText(f)}: higher application concurrency means more connections held open against the same max_connections budget.` : "No deploy explains the extra connection demand; load and slow queries are the likely drivers."
      }`,
    }),
    factors: (f) => [
      `Every request path in ${callersText(f)} shares one Postgres primary, so connection pressure spreads across services.`,
      "Pool acquisition timeouts are longer than upstream request budgets, so requests hold threads while they wait. That amplifies queueing.",
      f.loadFactor > 1 ? `Traffic was ${Math.round(f.loadFactor * 100)}% of the daily average at onset, near peak.` : "Traffic was within its normal daily range, so load alone does not explain the exhaustion.",
    ],
    immediate: (f) => [
      ...(f.change ? [{ priority: "P0" as const, action: `Roll back ${f.change.service} to its previous version`, rationale: `Removes the concurrency increase from ${f.change.version ?? "the latest change"} without a schema change.` }] : []),
      { priority: "P0", action: `Raise PgBouncer pool size for ${f.origin} temporarily (400 → 600)`, rationale: "Buys headroom while the source of connection demand is removed." },
      { priority: "P1", action: "Lower client pool acquisition timeout below the gateway budget (≤ 800ms)", rationale: "Fail fast instead of queueing requests that will time out anyway." },
    ],
    followUp: () => [
      { priority: "P1", action: "Set per-service connection quotas at PgBouncer", rationale: "One service can no longer starve the others." },
      { priority: "P2", action: "Add a pre-deploy check that caps total pool size against max_connections", rationale: "Catches concurrency changes that would exceed the database budget." },
    ],
    prevention: [
      "Alert on connection utilisation above 80% of max_connections, well before exhaustion.",
      "Run load tests that cover pool sizing whenever worker or thread counts change.",
      "Move read-heavy endpoints to the read replicas to reduce primary connection demand.",
    ],
  },
  {
    id: "bad-deploy",
    label: "Regression introduced by a release",
    category: "Change",
    signatures: [
      { id: "panic", label: "Runtime panic", re: /panic:|nil pointer dereference/i },
      { id: "decode", label: "Payload decode failure", re: /failed to decode|unknown field/i },
      { id: "upstream-500", label: "Upstream 500 from dependency", re: /authorization failed .* returned 500/i },
    ],
    keywords: ["deploy", "release", "rollout", "500", "regression", "payments", "charge"],
    expect: { metric: "errors", kinds: ["service", "gateway"] },
    changeHorizonMin: 45,
    rootCause: (f) => ({
      title: f.change ? `Regression in ${f.change.service} ${f.change.version ?? "release"}` : `Code-level failure in ${f.origin}`,
      detail: `${f.origin} began failing requests with runtime panics and payload decode errors${f.change ? ` ${Math.round(f.changeLeadMin ?? 0)} minutes after ${f.change.version ?? "a release"} ("${f.change.summary}") rolled out` : ""}. The errors come from the application itself: latency barely moved and dependencies stayed healthy. The new code path most likely assumes a field older clients don't send.`,
    }),
    factors: (f) => [
      f.change ? `${f.change.version} went to 100% of traffic without a canary hold.` : "No canary signal was available to catch the regression before full exposure.",
      `Downstream callers (${callersText(f)}) don't degrade gracefully, so the failure reaches the customer.`,
      "Contract tests don't cover requests that omit optional fields.",
    ],
    immediate: (f) => [
      { priority: "P0", action: `Roll back ${f.origin}${f.change?.version ? ` from ${f.change.version}` : ""} to the last known-good build`, rationale: "Fastest way to restore service. The regression is isolated to the new release." },
      { priority: "P1", action: "Replay or reconcile requests that failed during the window", rationale: "Recovers orders and charges that failed outright rather than timing out." },
    ],
    followUp: () => [
      { priority: "P1", action: "Add a contract test for requests missing the new optional field", rationale: "Reproduces the exact failure in CI." },
      { priority: "P2", action: "Gate the deploy pipeline on automated canary analysis (error rate and p99)", rationale: "Limits blast radius to a small share of traffic." },
    ],
    prevention: [
      "Progressive delivery: 1% → 10% → 50% → 100% with automated rollback on SLO burn.",
      "Treat new request fields as optional with defaults, and validate at the edge.",
      "Recover from handler panics and return typed errors instead of crashing the request.",
    ],
  },
  {
    id: "cache-stampede",
    label: "Cache eviction storm",
    category: "Capacity",
    signatures: [
      { id: "evicted", label: "Mass key eviction", re: /evicted \d+ keys|maxmemory/i },
      { id: "hit-ratio", label: "Cache hit ratio collapse", re: /hit ratio dropped/i },
      { id: "redis-timeout", label: "Cache client timeout", re: /redis: i\/o timeout/i },
    ],
    keywords: ["cache", "redis", "login", "session", "slow", "latency"],
    expect: { metric: "latency", kinds: ["cache"] },
    changeHorizonMin: 45,
    rootCause: (f) => ({
      title: `Eviction storm on ${f.origin}`,
      detail: `${f.origin} hit its memory ceiling and began evicting hot keys under allkeys-lru. Cache misses sent reads through to the database at the same moment for ${callersText(f)}, so latency rose everywhere together.${
        f.change ? ` This follows ${changeText(f)}, which reduced the headroom.` : ""
      }`,
    }),
    factors: (f) => [
      "Session and profile keys share one keyspace with bulk catalogue data, so hot keys are evicted alongside cold ones.",
      "There is no request coalescing on misses, so each eviction becomes N parallel database reads.",
      `${f.callers.length} services depend on the cache synchronously on their hot path.`,
    ],
    immediate: (f) => [
      ...(f.change ? [{ priority: "P0" as const, action: `Revert the ${f.change.service} change ("${f.change.summary}")`, rationale: "Restores memory headroom immediately." }] : []),
      { priority: "P0", action: `Scale ${f.origin} memory or add a shard`, rationale: "Stops eviction while the keyspace is rebalanced." },
      { priority: "P1", action: "Pre-warm the session keyspace", rationale: "Shortens recovery by avoiding a second miss wave." },
    ],
    followUp: () => [
      { priority: "P1", action: "Separate session keys onto a dedicated noeviction instance", rationale: "Hot session data is never evicted by bulk data." },
      { priority: "P2", action: "Add single-flight request coalescing on cache misses", rationale: "Prevents thundering-herd reads." },
    ],
    prevention: [
      "Alert on used_memory above 85% and on eviction rate, not just on latency.",
      "Capacity-review any maxmemory change against the 7-day peak keyspace size.",
      "Use probabilistic early expiration (jittered TTLs) to avoid synchronized misses.",
    ],
  },
  {
    id: "kafka-consumer-lag",
    label: "Event pipeline backpressure",
    category: "Infrastructure",
    signatures: [
      { id: "consumer-lag", label: "Consumer group lag", re: /consumer group .* lag/i },
      { id: "isr-shrink", label: "ISR shrink / replica out of sync", re: /ISR shrink|fell out of sync/i },
      { id: "produce-latency", label: "Producer latency over budget", re: /produce latency/i },
      { id: "rebalance", label: "Consumer rebalance", re: /rebalance in progress|commit failed/i },
    ],
    keywords: ["kafka", "queue", "lag", "email", "notification", "delayed", "events"],
    expect: { metric: "latency", kinds: ["queue"] },
    changeHorizonMin: 60,
    rootCause: (f) => ({
      title: `Replication and rebalance churn on ${f.origin}`,
      detail: `A broker in ${f.origin} fell out of the in-sync replica set, which raised produce latency and triggered repeated consumer-group rebalances. Consumers (${callersText(f)}) spent their time rebalancing instead of processing, so lag built up on order.events.${
        f.change ? ` Timing matches ${changeText(f)}.` : ""
      }`,
    }),
    factors: () => [
      "The replacement broker had to re-replicate partitions while serving live traffic.",
      "The consumer session timeout is shorter than the broker's catch-up stalls, so every stall triggers a rebalance.",
      "Notifications rely on a single consumer group with no lag-based autoscaling.",
    ],
    immediate: (f) => [
      { priority: "P0", action: "Throttle partition reassignment bandwidth on the recovering broker", rationale: "Lets the replica catch up without starving producers." },
      { priority: "P1", action: "Raise session.timeout.ms on the notifications consumer group", rationale: "Stops the rebalance loop so consumers can drain the backlog." },
      { priority: "P1", action: `Temporarily scale ${f.callers.includes("notification-service") ? "notification-service" : "consumers"} to drain lag`, rationale: "Clears the backlog faster once rebalancing stops." },
    ],
    followUp: () => [
      { priority: "P2", action: "Autoscale consumers on lag (KEDA) rather than CPU", rationale: "Matches capacity to backlog." },
      { priority: "P2", action: "Runbook: broker replacement with throttled reassignment", rationale: "Makes routine maintenance non-disruptive." },
    ],
    prevention: [
      "Alert on consumer lag in seconds for user-visible topics, not only on broker health.",
      "Schedule broker replacements outside peak and pre-throttle reassignment.",
      "Use cooperative-sticky assignment to reduce stop-the-world rebalances.",
    ],
  },
  {
    id: "tls-cert-expiry",
    label: "Expired TLS certificate",
    category: "Configuration",
    signatures: [
      { id: "cert-expired", label: "Certificate expired", re: /certificate has expired|chain .* expired/i },
      { id: "handshake", label: "TLS handshake failure", re: /TLS handshake failed|client hello rejected/i },
    ],
    keywords: ["tls", "ssl", "certificate", "cert", "handshake", "unreachable", "connect"],
    expect: { metric: "errors", kinds: ["edge", "gateway"] },
    changeHorizonMin: 24 * 60,
    rootCause: (f) => ({
      title: `Expired certificate served by ${f.origin}`,
      detail: `${f.origin} is presenting an expired certificate for *.acme.io, so clients abort the TLS handshake before any request reaches the platform. Backend traffic dropped (${list(f.shadowed.slice(0, 3)) || "downstream services"}) because traffic never arrived, not because those services failed.${
        f.change ? ` The renewal path failed earlier: ${f.change.summary}.` : ""
      }`,
    }),
    factors: (f) => [
      "Renewal failure alerts were routed to a channel nobody watches.",
      "No synthetic check validates certificate expiry from outside the network.",
      `The traffic drop on ${list(f.shadowed.slice(0, 2)) || "downstream services"} could be mistaken for low demand and slowed diagnosis.`,
    ],
    immediate: () => [
      { priority: "P0", action: "Issue a replacement certificate from the backup CA and push it to all edge POPs", rationale: "Restores handshakes globally within minutes." },
      { priority: "P1", action: "Purge any client-side certificate pinning caches that saw the expired chain", rationale: "Some mobile clients cache handshake failures." },
    ],
    followUp: () => [
      { priority: "P1", action: "Fix cert-manager ACME configuration and backfill renewal monitoring", rationale: "Addresses the failed automation." },
      { priority: "P2", action: "Add a second ACME issuer as fallback", rationale: "Removes the single point of failure in renewal." },
    ],
    prevention: [
      "Synthetic external check alerting at 21, 14 and 7 days before certificate expiry.",
      "Route certificate automation alerts to the owning team's paging policy.",
      "Track certificate inventory with owners and expiry in the service catalogue.",
    ],
  },
  {
    id: "memory-leak",
    label: "Memory leak / OOM restarts",
    category: "Resource",
    signatures: [
      { id: "oom", label: "Container OOMKilled", re: /OOMKilled/i },
      { id: "heap", label: "Heap pressure", re: /heap usage|GC pause/i },
    ],
    keywords: ["memory", "oom", "leak", "restart", "heap", "gc", "search"],
    expect: { metric: "memory" },
    changeHorizonMin: 180,
    rootCause: (f) => ({
      title: `Unbounded memory growth in ${f.origin}`,
      detail: `${f.origin} heap grows steadily after every restart until pods are OOMKilled, in a sawtooth pattern. Garbage collection pauses before each kill drive the latency and error spikes seen by ${callersText(f)}.${
        f.change ? ` Growth began after ${changeText(f)}, which points to a cache or buffer without an eviction bound.` : " The growth pattern points to a cache or buffer without an eviction bound."
      }`,
    }),
    factors: () => [
      "Memory limits are close to steady-state usage, so there is little headroom.",
      "Rolling restarts hide the leak as transient errors instead of a clear failure.",
      "No alert on memory growth rate, only on absolute usage.",
    ],
    immediate: (f) => [
      { priority: "P0", action: f.change?.version ? `Disable or roll back the feature introduced in ${f.change.version}` : `Roll back ${f.origin} to the previous build`, rationale: "Stops the growth at its source." },
      { priority: "P1", action: `Raise the ${f.origin} memory limit temporarily and spread restarts`, rationale: "Fewer concurrent OOMKills while the fix ships." },
    ],
    followUp: () => [
      { priority: "P1", action: "Bound the cache by entry count and size, with metrics", rationale: "Eliminates the leak class." },
      { priority: "P2", action: "Capture heap profiles automatically at 85% usage", rationale: "Speeds up diagnosis next time." },
    ],
    prevention: [
      "Alert on memory growth slope per pod (MB/min) sustained for more than 15 minutes.",
      "Soak tests in staging for releases that add caches or buffers.",
      "Treat OOMKill counts as an SLO-impacting signal in deploy verification.",
    ],
  },
  {
    id: "rate-limit-misconfig",
    label: "Rate-limit policy misconfiguration",
    category: "Configuration",
    signatures: [
      { id: "429", label: "Requests rejected with 429", re: /429 Too Many Requests/i },
      { id: "limiter", label: "Limiter rejecting in bulk", re: /rate limiter rejected/i },
    ],
    keywords: ["429", "rate", "limit", "throttle", "partner", "api"],
    expect: { metric: "errors", kinds: ["gateway", "edge"] },
    changeHorizonMin: 30,
    rootCause: (f) => ({
      title: `Rate-limit policy misconfigured on ${f.origin}`,
      detail: `${f.origin} is rejecting normal traffic with HTTP 429 under the tenant-default policy. Downstream services (${list(f.shadowed.slice(0, 3)) || "backends"}) show a matching traffic drop with healthy latency, which points to admission control rather than a capacity problem.${
        f.change ? ` The change is ${changeText(f)}.` : ""
      }`,
    }),
    factors: () => [
      "Policy changes deploy globally with no staged rollout.",
      "No schema validation or diff review flags an order-of-magnitude change.",
      "429s are excluded from the 5xx error SLO, which delayed paging.",
    ],
    immediate: (f) => [
      { priority: "P0", action: `Revert the rate-limit policy on ${f.origin}`, rationale: "Restores admission for legitimate traffic immediately." },
      { priority: "P1", action: "Notify affected partners and confirm retry backlogs drain", rationale: "Partners may have tripped their own circuit breakers." },
    ],
    followUp: () => [
      { priority: "P1", action: "Add bounds validation to the policy repository (CI)", rationale: "Rejects changes outside sane ranges." },
      { priority: "P2", action: "Stage policy rollouts by tenant cohort", rationale: "Limits blast radius of config errors." },
    ],
    prevention: [
      "Include 429 rate in availability SLOs for authenticated traffic.",
      "Require two-person review for gateway policy changes.",
      "Shadow-evaluate new policies against live traffic before enforcing.",
    ],
  },
  {
    id: "idp-latency",
    label: "Third-party identity provider degradation",
    category: "Dependency",
    signatures: [
      { id: "oidc-timeout", label: "OIDC provider timeout", re: /OIDC|idp-partner/i },
      { id: "jwks", label: "JWKS refresh failure", re: /JWKS refresh failed/i },
      { id: "auth-budget", label: "Auth exceeding route budget", re: /auth-service p99 .* exceeds/i },
    ],
    keywords: ["login", "sign-in", "signin", "sso", "auth", "oauth", "idp"],
    expect: { metric: "latency", kinds: ["service"] },
    changeHorizonMin: 30,
    rootCause: (f) => ({
      title: `External identity provider slowing ${f.origin}`,
      detail: `${f.origin} is blocked on synchronous calls to an external OIDC provider that has started timing out. Our own components look healthy: database and cache latency are flat. The delay reaches ${callersText(f)} through the session and login routes.`,
    }),
    factors: () => [
      "OIDC discovery and JWKS fetches are on the request path, not cached ahead of time.",
      "The provider timeout (10s) is longer than the route budget, so threads stay pinned.",
      "No fallback path for SSO tenants when the partner degrades.",
    ],
    immediate: (f) => [
      { priority: "P0", action: `Serve cached discovery documents and JWKS in ${f.origin} (TTL 15 min)`, rationale: "Removes the external call from the hot path." },
      { priority: "P1", action: "Shorten the provider timeout to 2s with a degraded-mode response", rationale: "Fails fast and frees capacity for non-SSO logins." },
    ],
    followUp: () => [
      { priority: "P1", action: "Prefetch JWKS asynchronously on a schedule", rationale: "Decouples login latency from the partner's availability." },
      { priority: "P2", action: "Subscribe to the partner status page in Sentinel", rationale: "Correlates external incidents automatically." },
    ],
    prevention: [
      "Wrap every third-party call in a circuit breaker with explicit budgets.",
      "Alert on dependency latency separately from service latency.",
      "Contract an SLA and a secondary provider for critical identity flows.",
    ],
  },
  {
    id: "search-slow-queries",
    label: "Hot shard / slow queries",
    category: "Performance",
    signatures: [
      { id: "slow-query", label: "Slow query on shard", re: /slow query took/i },
      { id: "breaker", label: "Circuit breaker tripped", re: /circuit_breaking_exception/i },
      { id: "partial", label: "Partial results returned", re: /partial results/i },
    ],
    keywords: ["search", "query", "shard", "partial", "slow", "index"],
    expect: { metric: "latency", kinds: ["search"] },
    changeHorizonMin: 60,
    rootCause: (f) => ({
      title: `Hot shard on ${f.origin}`,
      detail: `Slow queries are concentrated on a single shard of products-v7, which suggests uneven document routing rather than cluster-wide load. ${callersText(f)} time out waiting for that shard and return partial results.${
        f.change ? ` The skew follows ${changeText(f)}.` : ""
      }`,
    }),
    factors: () => [
      "Custom routing keys put a disproportionate share of documents on one shard.",
      "Background merges after the bulk import compete with query traffic.",
      "Search timeouts return partial results silently rather than erroring.",
    ],
    immediate: (f) => [
      { priority: "P1", action: `Relocate hot-shard replicas to dedicated nodes on ${f.origin}`, rationale: "Isolates query load from merge pressure." },
      { priority: "P1", action: "Throttle background merges until the import settles", rationale: "Frees IO for queries." },
    ],
    followUp: () => [
      { priority: "P2", action: "Re-shard products index with balanced routing", rationale: "Fixes the skew permanently." },
      { priority: "P2", action: "Emit a metric for partial-result responses", rationale: "Turns a silent failure into an alertable signal." },
    ],
    prevention: [
      "Alert on per-shard latency skew (max/median above 3×).",
      "Run bulk imports through a throttled pipeline outside peak hours.",
      "Capacity-check shard sizes after large catalogue changes.",
    ],
  },
  {
    id: "inventory-lock-contention",
    label: "Row-lock contention",
    category: "Performance",
    signatures: [
      { id: "deadlock", label: "Deadlock detected", re: /deadlock detected/i },
      { id: "lock-wait", label: "Lock wait timeout", re: /lock wait timeout/i },
      { id: "reserve-conflict", label: "Reservation conflict", re: /reserve-stock .* 409|409 conflict/i },
    ],
    keywords: ["stock", "inventory", "flash", "sale", "reservation", "cart", "lock"],
    expect: { metric: "errors", kinds: ["service"] },
    changeHorizonMin: 30,
    rootCause: (f) => ({
      title: `Lock contention on hot rows in ${f.origin}`,
      detail: `Reservations for a small set of hot SKUs are serialised on row-level locks in stock_levels. Deadlocks and lock-wait timeouts in ${f.origin} turn into 409 conflicts for ${callersText(f)}, and client retries make the contention worse.${
        f.change ? ` The surge in demand for those SKUs follows ${changeText(f)}.` : ""
      }`,
    }),
    factors: () => [
      "A single row per SKU is the concurrency bottleneck for popular items.",
      "Three immediate retries without jitter multiply lock attempts.",
      "Flash-sale traffic was not load tested against the reservation path.",
    ],
    immediate: (f) => [
      { priority: "P0", action: "Switch hot SKUs to the sharded counter reservation path", rationale: "Spreads lock contention across rows." },
      { priority: "P1", action: `Reduce ${callersText(f)} retries to 1 with jittered backoff`, rationale: "Stops retry amplification." },
    ],
    followUp: () => [
      { priority: "P2", action: "Load test the reservation path with flash-sale traffic shape", rationale: "Validates the fix before the next sale." },
      { priority: "P2", action: "Queue-based reservations for SKUs above a demand threshold", rationale: "Removes lock contention entirely for spikes." },
    ],
    prevention: [
      "Pre-sale readiness checklist including hot-key analysis.",
      "Alert on deadlock rate per table.",
      "Bounded, jittered retries as a platform default.",
    ],
  },
];

export const MODE_MAP: Record<string, FailureMode> = Object.fromEntries(FAILURE_MODES.map((m) => [m.id, m]));

/** fallback narrative when no known failure mode matches the evidence */
export function genericNarrative(f: Facts): { title: string; detail: string; category: string } {
  const kind = SERVICE_MAP[f.origin]?.kind;
  const metricWord = f.metric === "errorRate" ? "error rate" : f.metric === "rps" ? "traffic" : f.metric === "mem" ? "memory" : f.metric === "cpu" ? "CPU" : "latency";
  return {
    title: `${metricWord[0]!.toUpperCase()}${metricWord.slice(1)} anomaly originating in ${f.origin}`,
    detail: `The earliest anomaly in the window is ${metricWord} on ${f.origin} (${kind ?? "service"}), at ${f.ratio.toFixed(1)}× baseline from ${formatClock(f.onset)}${
      f.callers.length ? `, followed by ${callersText(f)}` : ""
    }. The logs don't match a known failure signature, so this hypothesis rests on timing and topology alone.`,
    category: "Unclassified",
  };
}
