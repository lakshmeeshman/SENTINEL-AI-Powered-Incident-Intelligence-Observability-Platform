import { NextResponse } from "next/server";
import { DEFAULT_MODEL, buildPrompt, parseNarrative } from "@/lib/intelligence/ai";
import type { Analysis, Incident } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST { incident, evidence } → { mode: "ai", model, narrative } | { mode: "demo", reason }
 * The client always has a complete deterministic analysis already; this endpoint only
 * upgrades the narrative when an Anthropic key is configured. It never throws to the client.
 */
export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ mode: "demo", reason: "ANTHROPIC_API_KEY not configured" });

  let body: { incident?: Incident; evidence?: Analysis };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ mode: "demo", reason: "invalid request body" }, { status: 400 });
  }
  if (!body.incident || !body.evidence) return NextResponse.json({ mode: "demo", reason: "missing incident or evidence" }, { status: 400 });

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const { system, user } = buildPrompt(body.incident, body.evidence);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1800, temperature: 0.2, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[sentinel] Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
      return NextResponse.json({ mode: "demo", reason: `Anthropic API returned ${res.status}` });
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    const narrative = parseNarrative(text);
    if (!narrative) return NextResponse.json({ mode: "demo", reason: "model returned unparseable output" });
    return NextResponse.json({ mode: "ai", model, narrative });
  } catch (e) {
    return NextResponse.json({ mode: "demo", reason: e instanceof Error && e.name === "AbortError" ? "Anthropic API timed out" : "Anthropic API unreachable" });
  } finally {
    clearTimeout(timer);
  }
}
