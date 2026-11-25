import { NextResponse } from "next/server";
import { DEFAULT_MODEL } from "@/lib/intelligence/ai";

export const dynamic = "force-dynamic";

export function GET() {
  const enabled = Boolean(process.env.ANTHROPIC_API_KEY);
  return NextResponse.json({
    ai: { enabled, provider: "anthropic", model: enabled ? process.env.ANTHROPIC_MODEL || DEFAULT_MODEL : null },
    version: "1.0.0",
    time: Date.now(),
  });
}
