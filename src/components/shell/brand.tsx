import { cn } from "@/lib/utils";

/** Sentinel mark: a signal trace with a single notch, the moment an anomaly is caught. */
export function SentinelMark({ className, animated }: { className?: string; animated?: boolean }) {
  return (
    <span className={cn("relative inline-flex h-7 w-7 items-center justify-center rounded-[8px] bg-[#0f1320] ring-1 ring-[rgb(139_124_246/0.35)] shadow-[0_0_18px_-4px_rgb(139_124_246/0.55),inset_0_1px_0_rgb(255_255_255/0.06)]", className)}>
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden>
        <defs>
          <linearGradient id="sentinel-g" x1="0" y1="0" x2="24" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#36d6e7" />
            <stop offset="1" stopColor="#b3a8ff" />
          </linearGradient>
        </defs>
        <path
          d="M2 13h4.2l2.3-6.5 3.6 11 2.6-8 1.6 3.5H22"
          stroke="url(#sentinel-g)"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={animated ? "60" : undefined}
          style={animated ? { animation: "dash 2.4s linear infinite" } : undefined}
        />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("text-[14.5px] font-semibold tracking-[-0.02em] text-ink", className)}>Sentinel</span>;
}
