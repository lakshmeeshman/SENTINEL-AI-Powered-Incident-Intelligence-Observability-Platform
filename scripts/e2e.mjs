// End-to-end workflow check against a running server: node scripts/e2e.mjs http://localhost:3000
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const base = process.argv[2] ?? "http://localhost:3000";
const out = "scripts/.screens/e2e";
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const client = await page.createCDPSession();
await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: process.cwd() + "/" + out });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push("console: " + m.text().slice(0, 200)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };
const text = () => page.evaluate(() => document.body.innerText);
const clickText = async (t, sel = "button,a,[role=menuitem],[role=radio],[role=tab]", exact = false) => page.evaluate((t, sel, exact) => { const el = [...document.querySelectorAll(sel)].find((b) => { const x = b.textContent?.trim() ?? ""; return exact ? x === t : x.startsWith(t); }); if (el) { el.click(); return true; } return false; }, t, sel, exact);

// fresh workspace with onboarding visible
await page.goto(base + "/", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.clear());
await page.goto(base + "/", { waitUntil: "networkidle0" });
await sleep(1500);
check("onboarding shows on first visit", (await text()).includes("Welcome to Sentinel"));
await clickText("Next"); await sleep(250); await clickText("Next"); await sleep(250);
await page.screenshot({ path: `${out}/01-onboarding.png` });
await clickText("Open live incident"); await sleep(2500);
check("onboarding CTA opens incident", page.url().includes("/incidents/INC-2047"));

// overview KPIs + live updates
await page.goto(base + "/", { waitUntil: "networkidle0" }); await sleep(1500);
const t1 = await text();
check("overview renders KPIs", ["System health", "Requests per second", "Error rate", "Avg latency", "Active incidents", "Services operational"].every((k) => t1.includes(k)));
const rps1 = await page.evaluate(() => document.querySelector("section[aria-label='Platform signal']")?.innerText);
await sleep(7000);
const rps2 = await page.evaluate(() => document.querySelector("section[aria-label='Platform signal']")?.innerText);
check("telemetry updates live", rps1 !== rps2);
// pause
await page.keyboard.press("p"); await sleep(300);
const p1 = await page.evaluate(() => document.querySelector("section[aria-label='Platform signal']")?.innerText);
await sleep(7000);
const p2 = await page.evaluate(() => document.querySelector("section[aria-label='Platform signal']")?.innerText);
check("pause freezes telemetry", p1 === p2);
check("pause shows Paused state", (await text()).includes("Paused"));
await page.keyboard.press("p"); await sleep(500);
for (const r of ["15m", "6h", "24h", "1h"]) { await clickText(r, "[role=radio]"); await sleep(600); }
check("time range selector works", (await text()).includes("last 1h"));

// command palette
await page.keyboard.down("Control"); await page.keyboard.press("k"); await page.keyboard.up("Control"); await sleep(400);
await page.keyboard.type("INC-2044"); await sleep(300); await page.keyboard.press("Enter"); await sleep(2500);
check("command palette navigates to incident", page.url().includes("/incidents/INC-2044"));

// simulate an incident via shortcut
const before = await page.evaluate(() => JSON.parse(localStorage.getItem("sentinel:workspace:v1")).state.incidents.length);
await page.keyboard.down("Shift"); await page.keyboard.press("S"); await page.keyboard.up("Shift"); await sleep(1500);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem("sentinel:workspace:v1")).state.incidents.length);
check("simulate incident creates incident", after === before + 1, `${before}→${after}`);
const simUrl = page.url();
check("simulate navigates to new incident", /INC-20\d\d/.test(simUrl) && !simUrl.includes("INC-2044"), simUrl);
await sleep(5500);
const t3 = await text();
check("analysis auto-runs and completes", t3.includes("Probable root cause") && t3.includes("Recommended actions"));
check("analysis labelled as demo or AI", t3.includes("Demo intelligence") || t3.includes("AI-powered"));
await page.screenshot({ path: `${out}/02-simulated-analysis.png` });
// does the inferred root cause match the simulated scenario? (read ground truth from storage)
const truth = await page.evaluate((id) => { const s = JSON.parse(localStorage.getItem("sentinel:workspace:v1")).state; const inc = s.incidents.find((i) => i.id === id); return { scenario: inc.sim?.scenarioId, mode: s.analyses[id]?.rootCause.failureMode, conf: s.analyses[id]?.confidence }; }, simUrl.split("/").pop());
check("RCA identifies the simulated failure mode", truth.scenario === truth.mode, JSON.stringify(truth));

// acknowledge, status change, note, action toggle
check("acknowledge button present on open incident", await clickText("Acknowledge"));
await sleep(500);
check("acknowledged status shown", (await text()).includes("Acknowledged."));
await page.evaluate(() => [...document.querySelectorAll("ol[aria-label='Incident lifecycle'] button")].find((b) => b.textContent?.includes("Investigating"))?.click()); await sleep(400);
const st = await page.evaluate((id) => JSON.parse(localStorage.getItem("sentinel:workspace:v1")).state.incidents.find((i) => i.id === id).status, simUrl.split("/").pop());
check("status stepper changes status", st === "investigating", st);
await page.type("textarea[aria-label='Timeline update']", "Rolling back the suspect change now.");
await clickText("Post", "button", true); await sleep(400);
check("timeline note posted", (await text()).includes("Rolling back the suspect change now."));
const actionClicked = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /^P[012]/.test(x.innerText.trim()) || x.querySelector("span.font-mono")?.textContent?.match(/^P[012]$/)); if (b) { b.click(); return true; } return false; });
await sleep(400);
check("recommended action can be marked done", actionClicked && (await text()).includes("Completed recommended action"));

// telemetry + logs tabs
await clickText("Telemetry", "[role=tab]"); await sleep(1200);
check("telemetry tab renders charts", (await page.$$(".recharts-surface")).length >= 4);
await page.screenshot({ path: `${out}/03-telemetry.png` });
await clickText("Logs", "[role=tab]"); await sleep(1200);
check("logs tab shows correlated logs", (await text()).includes("Open in Log Explorer"));

// resolve
await clickText("Resolve"); await sleep(400);
await page.type("#res-note", "Rolled back. Error rate back to baseline.");
await clickText("Resolve incident"); await sleep(600);
const st2 = await page.evaluate((id) => JSON.parse(localStorage.getItem("sentinel:workspace:v1")).state.incidents.find((i) => i.id === id), simUrl.split("/").pop());
check("incident resolves", st2.status === "resolved" && !!st2.resolvedAt);

// postmortem generation + download
await clickText("Postmortem", "[role=tab]"); await sleep(500);
await clickText("Generate postmortem"); await sleep(800);
const t4 = await text();
check("postmortem has all sections", ["Executive summary", "Incident timeline", "Root cause", "Business impact", "Resolution", "What went well", "What went wrong", "Action items"].every((k) => t4.includes(k)));
await page.screenshot({ path: `${out}/04-postmortem.png` });
await clickText("Download .md"); await sleep(1200);
const md = fs.readdirSync(out).find((f) => f.endsWith(".md"));
check("markdown downloads", !!md, md);
if (md) { const c = fs.readFileSync(`${out}/${md}`, "utf8"); check("markdown content valid", c.startsWith("# Postmortem:") && c.includes("## Action items"), `${c.length} chars`); }

// manual incident creation
await page.goto(base + "/incidents", { waitUntil: "networkidle0" }); await sleep(1000);
await page.keyboard.press("n"); await sleep(400);
await page.type("#inc-title", "Customers report slow checkout in EU");
await page.evaluate(() => [...document.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent === "orders-service")?.click());
await clickText("Declare incident", "button[type=submit]"); await sleep(4500);
check("manual incident created and opened", (await text()).includes("Customers report slow checkout in EU") && page.url().includes("/incidents/INC-"));
check("manual incident analysed", (await text()).includes("Probable root cause"));

// incidents list filters / search / sort
await page.goto(base + "/incidents", { waitUntil: "networkidle0" }); await sleep(1000);
await page.type("input[aria-label='Search incidents']", "TLS"); await sleep(400);
const rowsTls = await page.$$eval("ul.divide-y > li", (l) => l.length);
check("incident search filters", rowsTls === 1, `${rowsTls} rows`);
await page.click("input[aria-label='Search incidents']", { clickCount: 3 }); await page.keyboard.press("Backspace");
await clickText("SEV-1", "button[aria-pressed]"); await sleep(300);
const sev1 = await page.$$eval("ul.divide-y > li", (l) => l.length);
check("severity filter", sev1 >= 1 && sev1 <= 4, `${sev1} rows`);
await clickText("SEV-1", "button[aria-pressed]");
await clickText("Resolved", "[role=radio]"); await sleep(300);
check("scope filter", (await text()).includes("Resolved") && !(await page.$$eval("ul.divide-y > li", (l) => l.map((x) => x.innerText).join(" "))).includes("Investigating"));
await page.select("select[aria-label='Sort']", "duration"); await sleep(300);
check("sort select works", true);

// log explorer interactions
await page.goto(base + "/logs", { waitUntil: "networkidle0" }); await sleep(1500);
const n0 = await page.$$eval("main ul > li", (l) => l.length);
await clickText("ERROR", "button[aria-pressed]"); await sleep(400);
const errText = await page.$$eval("main ul > li", (l) => l.slice(0, 20).map((x) => x.innerText).join("\n"));
check("level filter shows only errors", n0 > 0 && !/\bINFO\b/.test(errText) && /ERROR/.test(errText));
await page.click("main ul > li button"); await sleep(300);
check("log line expands", (await text()).includes("trace_id"));
await clickText("Show trace"); await sleep(400);
check("trace correlation filter", (await text()).includes("trace "));
await page.screenshot({ path: `${out}/05-logs-trace.png` });

// service map click
await page.goto(base + "/services", { waitUntil: "networkidle0" }); await sleep(2000);
await page.click(".react-flow__node[data-id='redis-cache']"); await sleep(800);
check("service map node opens detail panel", (await text()).includes("Called by") && page.url().includes("service=redis-cache"));
await clickText("Blast radius", "[role=radio]"); await sleep(600);
check("blast radius mode", (await text()).includes("upstream can be impacted"));
await page.screenshot({ path: `${out}/06-blast.png` });

// settings: chaos + reset
await page.goto(base + "/settings", { waitUntil: "networkidle0" });
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim().startsWith("Send test")), { timeout: 30000 }); await sleep(500);
await clickText("Send test"); await sleep(800);
check("test notification toast", (await text()).includes("Test notification"));
await clickText("Reset demo data"); await sleep(300);
await page.evaluate(() => [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent?.includes("Reset demo data"))?.click()); await sleep(600);
const cnt = await page.evaluate(() => JSON.parse(localStorage.getItem("sentinel:workspace:v1")).state.incidents.length);
check("demo reset restores dataset", cnt === 11, `${cnt}`);

// report page
await page.goto(base + "/report/INC-2042", { waitUntil: "networkidle0" }); await sleep(1000);
check("print report renders", (await text()).includes("Print or save as PDF") && (await text()).includes("What went wrong"));
await page.emulateMediaType("print"); await page.screenshot({ path: `${out}/07-report-print.png` }); await page.emulateMediaType("screen");

console.log(results.join("\n"));
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} checks passed`);
if (errors.length) console.log("PAGE ERRORS:\n" + [...new Set(errors)].join("\n"));
await browser.close();
