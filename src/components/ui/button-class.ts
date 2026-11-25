import { cn } from "@/lib/utils";

/* Shared by server and client components, so it lives outside any "use client" module. */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "signal";
export type ButtonSize = "xs" | "sm" | "md" | "icon" | "icon-sm";

export function buttonClass({ variant = "secondary", size = "sm", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background,color,border-color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-45 active:translate-y-px",
    size === "xs" && "h-6 rounded-[5px] px-2 text-[11.5px]",
    size === "sm" && "h-8 rounded-[6px] px-3 text-[13px]",
    size === "md" && "h-9 rounded-[7px] px-3.5 text-[13.5px]",
    size === "icon" && "h-8 w-8 rounded-[6px]",
    size === "icon-sm" && "h-7 w-7 rounded-[5px]",
    variant === "primary" &&
      "bg-intel text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_0_0_1px_rgb(139_124_246/0.6),0_6px_18px_-6px_rgb(139_124_246/0.6)] hover:bg-[#9a8cff]",
    variant === "signal" &&
      "bg-signal/12 text-signal ring-1 ring-signal/30 hover:bg-signal/18 hover:ring-signal/45",
    variant === "secondary" && "bg-raised text-ink ring-1 ring-hairline-strong hover:bg-overlay hover:ring-[rgb(148_163_196/0.24)]",
    variant === "outline" && "text-ink-muted ring-1 ring-hairline-strong hover:bg-raised hover:text-ink",
    variant === "ghost" && "text-ink-muted hover:bg-white/[0.04] hover:text-ink",
    variant === "danger" && "bg-critical/12 text-[#ff8da0] ring-1 ring-critical/35 hover:bg-critical/20",
    className
  );
}

