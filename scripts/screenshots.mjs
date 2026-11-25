// Regenerate README screenshots: start the app, then `node scripts/screenshots.mjs http://localhost:3000`
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const base = process.argv[2] ?? "http://localhost:3000";
const chrome = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const out = "docs/screenshots";
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = [
  { name: "overview", path: "/", w: 1600, h: 1000, wait: 2500 },
  { name: "incident-rca", path: "/incidents/INC-2047", w: 1600, h: 1000, wait: 7500, scroll: 0 },
  { name: "incident-rca-evidence", path: "/incidents/INC-2047", w: 1600, h: 1000, wait: 7500, scroll: 860 },
  { name: "service-map", path: "/services?service=postgres-primary", w: 1600, h: 1000, wait: 2500 },
  { name: "logs", path: "/logs", w: 1600, h: 1000, wait: 2500 },
  { name: "incidents", path: "/incidents", w: 1600, h: 1000, wait: 1500 },
  { name: "postmortem-report", path: "/report/INC-2042", w: 1280, h: 1000, wait: 1500 },
  { name: "mobile", path: "/", w: 390, h: 844, wait: 2500, dpr: 2 },
];
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  if (!localStorage.getItem("sentinel:workspace:v1")) localStorage.setItem("sentinel:workspace:v1", JSON.stringify({ state: { settings: { onboarded: true } }, version: 1 }));
});
for (const s of shots) {
  await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: s.dpr ?? 1 });
  await page.goto(base + s.path, { waitUntil: "networkidle0" });
  await sleep(s.wait);
  if (s.scroll) { await page.evaluate((y) => window.scrollTo(0, y), s.scroll); await sleep(600); }
  await page.screenshot({ path: `${out}/${s.name}.png` });
  console.log("saved", `${out}/${s.name}.png`);
}
await browser.close();
