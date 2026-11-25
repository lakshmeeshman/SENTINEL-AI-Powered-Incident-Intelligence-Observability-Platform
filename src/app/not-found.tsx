import Link from "next/link";
import { buttonClass } from "@/components/ui/button-class";
import { SentinelMark } from "@/components/shell/brand";

export default function NotFound() {
  return (
    <>
      <div className="backdrop" aria-hidden />
      <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <SentinelMark animated className="h-10 w-10" />
        <p className="mt-6 font-mono text-[12px] text-ink-subtle">404 · no signal</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.03em] text-ink">This page isn&apos;t being monitored</h1>
        <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink-muted">The address may be mistyped, or the incident was removed when the demo data was reset.</p>
        <div className="mt-6 flex gap-2">
          <Link href="/" className={buttonClass({ variant: "primary", size: "md" })}>
            Go to the command center
          </Link>
          <Link href="/incidents" className={buttonClass({ variant: "secondary", size: "md" })}>
            View incidents
          </Link>
        </div>
      </main>
    </>
  );
}
