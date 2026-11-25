import { buildSeed } from "../src/lib/sim/seed";
import { analyzeIncident } from "../src/lib/intelligence/engine";
import { createSimulatedIncident, createManualIncident } from "../src/lib/sim/factory";
import { SCENARIOS, SCENARIO_MAP } from "../src/lib/catalog/scenarios";

const now = Date.now();
const seed = buildSeed(now);
let ok = 0, total = 0;
const report = (inc: any, incidents: any[], changes: any[], at = now) => {
  const t0 = performance.now();
  const a = analyzeIncident({ incident: inc, incidents, changes, now: at });
  const ms = performance.now() - t0;
  const truth = inc.sim ? SCENARIO_MAP[inc.sim.scenarioId] : undefined;
  const pass = truth ? a.rootCause.failureMode === truth.id && a.rootCause.service === truth.origin : true;
  total++; if (pass) ok++;
  console.log(`${pass ? "PASS" : "FAIL"} ${inc.id} [${inc.status}] truth=${truth?.id ?? "manual"}@${truth?.origin ?? "-"} → ${a.rootCause.failureMode}@${a.rootCause.service} conf=${a.confidence}% anomalies=${a.anomalies.length} logs=${a.evidence.logsAnalyzed} failed=${a.impact.failedRequests} change=${a.evidence.changes[0]?.summary ?? "-"} (${ms.toFixed(0)}ms)`);
  if (!pass || process.env.V) { console.log("   ", a.executiveSummary); console.log("   ", a.signals.map(s=>`${s.id}:${s.score.toFixed(2)}`).join(" ")); console.log("   ", a.anomalies.slice(0,6).map(x=>`${x.service}.${x.metric}@${x.offsetSec}s z=${x.peakZ.toFixed(1)}`).join(" | ")); }
  return a;
};
for (const inc of seed.incidents) report(inc, seed.incidents, seed.changes);
// freshly simulated incidents of every scenario, analysed 4 minutes after detection
for (const sc of SCENARIOS) {
  const base = seed.incidents.filter(i => i.status === "resolved");
  const { incident, change } = createSimulatedIncident({ now: now - 4*60_000, incidents: base, scenarioId: sc.id, random: Math.random });
  const incs = [...base, incident];
  report(incident, incs, change ? [change, ...seed.changes] : seed.changes, now);
}
// manual incident overlapping active INC-2047
const m = createManualIncident({ title: "Customers say checkout is slow", severity: "SEV-3", description: "Support tickets about checkout spinning", services: ["orders-service"], startedMinutesAgo: 5, reporter: "Alex" }, now, seed.incidents);
const a = report(m, [...seed.incidents, m], seed.changes);
console.log("   manual summary:", a.executiveSummary);
const m2 = createManualIncident({ title: "Admin dashboard TLS certificate warning", severity: "SEV-4", description: "Internal users see cert warning", services: ["edge-cdn"], startedMinutesAgo: 2, reporter: "Alex" }, now - 3*86400_000, seed.incidents);
const a2 = report(m2, seed.incidents.filter(i=>i.impactStartedAt < now-3*86400_000 - 3600_000 || i.status!=="resolved"), seed.changes, now - 3*86400_000 + 60_000);
console.log("   manual2 summary:", a2.executiveSummary);
console.log(`\n${ok}/${total} correct`);
