// Usage: node scripts/shoot.mjs <baseUrl> <outDir> <path[@WxH][#action]>...
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [base, out, ...targets] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const errors = [];
for (const t of targets) {
  const [pathPart, action] = t.split("#");
  const [p, size] = pathPart.split("@");
  const [w, h] = (size ?? "1600x1000").split("x").map(Number);
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(`${p}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${p}: console: ${m.text().slice(0, 300)}`); });
  await page.evaluateOnNewDocument(() => {
    if (!localStorage.getItem("sentinel:workspace:v1")) localStorage.setItem("sentinel:workspace:v1", JSON.stringify({ state: { settings: { onboarded: !location.search.includes("onboard") } }, version: 1 }));
  });
  await page.goto(base + p, { waitUntil: "networkidle0", timeout: 90000 });
  await new Promise((r) => setTimeout(r, 2200));
  if (action) {
    for (const step of action.split(";")) {
      const [kind, arg] = step.split("=");
      if (kind === "click") { const el = await page.$(arg); if (el) await el.click(); else errors.push(`${p}: missing ${arg}`); }
      if (kind === "text") { const ok = await page.evaluate((txt) => { const el = [...document.querySelectorAll("button,a,[role=tab]")].find((b) => b.textContent?.trim().startsWith(txt)); if (el) { el.click(); return true; } return false; }, arg); if (!ok) errors.push(`${p}: no button text ${arg}`); }
      if (kind === "key") await page.keyboard.press(arg);
      if (kind === "combo") { const [m, k] = arg.split("+"); await page.keyboard.down(m); await page.keyboard.press(k); await page.keyboard.up(m); }
      if (kind === "wait") await new Promise((r) => setTimeout(r, Number(arg)));
      if (kind === "scroll") await page.evaluate((y) => window.scrollTo(0, Number(y)), arg);
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  const name = (p.replace(/[/?=&]/g, "_") || "root") + (size ? `-${size}` : "") + (action ? `-${action.replace(/[^a-z0-9]/gi, "").slice(0, 24)}` : "");
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: process.env.FULL === "1" });
  console.log("shot", `${out}/${name}.png`);
  await page.close();
}
await browser.close();
if (errors.length) { console.log("ERRORS:\n" + [...new Set(errors)].join("\n")); }
