"use client";

import * as React from "react";
import {
  Activity,
  CheckCircle2,
  CircleDashed,
  Crosshair,
  Eye,
  Search,
  type LucideIcon,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import type { IncidentStatus, Severity, Tone } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/store";

/* ───────────── Button ───────────── */

import { buttonClass, type ButtonSize as Size, type ButtonVariant as Variant } from "./button-class";
export { buttonClass };

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  function Button({ variant, size, className, type = "button", ...props }, ref) {
    return <button ref={ref} type={type} className={buttonClass({ variant, size, className })} {...props} />;
  }
);

/* ───────────── Tones ───────────── */

export const TONE: Record<Tone, { text: string; bg: string; ring: string; dot: string; hex: string }> = {
  good: { text: "text-good", bg: "bg-good/10", ring: "ring-good/25", dot: "bg-good", hex: "#34d399" },
  warning: { text: "text-warning", bg: "bg-warning/10", ring: "ring-warning/25", dot: "bg-warning", hex: "#fbbf24" },
  serious: { text: "text-serious", bg: "bg-serious/10", ring: "ring-serious/25", dot: "bg-serious", hex: "#fb923c" },
  critical: { text: "text-[#ff7389]", bg: "bg-critical/12", ring: "ring-critical/30", dot: "bg-critical", hex: "#f43f5e" },
  info: { text: "text-info", bg: "bg-info/10", ring: "ring-info/25", dot: "bg-info", hex: "#60a5fa" },
  neutral: { text: "text-ink-muted", bg: "bg-white/[0.04]", ring: "ring-hairline-strong", dot: "bg-ink-subtle", hex: "#949cb0" },
};

export const SEV_TONE: Record<Severity, Tone> = { "SEV-1": "critical", "SEV-2": "serious", "SEV-3": "warning", "SEV-4": "info" };
export const SEV_HEX: Record<Severity, string> = { "SEV-1": "#f43f5e", "SEV-2": "#fb923c", "SEV-3": "#fbbf24", "SEV-4": "#7dd3fc" };

/* ───────────── Badges ───────────── */

export function Badge({ tone = "neutral", className, children, icon: Icon }: { tone?: Tone; className?: string; children: React.ReactNode; icon?: LucideIcon }) {
  const t = TONE[tone];
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[4px] px-1.5 text-[11px] font-medium ring-1 ring-inset", t.text, t.bg, t.ring, className)}>
      {Icon && <Icon className="h-3 w-3" strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function SeverityBadge({ severity, pulse, className }: { severity: Severity; pulse?: boolean; className?: string }) {
  const tone = SEV_TONE[severity];
  const level = Number(severity.slice(-1));
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-[4px] px-1.5 font-mono text-[10.5px] font-semibold tracking-tight ring-1 ring-inset", TONE[tone].text, TONE[tone].bg, TONE[tone].ring, className)}>
      <span className="relative flex h-2.5 items-end gap-[1.5px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("w-[2px] rounded-[1px]", i < 5 - level ? TONE[tone].dot : "bg-white/15")} style={{ height: `${4 + i * 2}px` }} />
        ))}
        {pulse && <span className={cn("absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full", TONE[tone].dot)}><span className={cn("absolute inset-0 animate-pulse-ring rounded-full", TONE[tone].dot)} /></span>}
      </span>
      {severity}
    </span>
  );
}

const STATUS_ICON: Record<IncidentStatus, LucideIcon> = {
  open: CircleDashed,
  acknowledged: Eye,
  investigating: Search,
  identified: Crosshair,
  monitoring: Activity,
  resolved: CheckCircle2,
};
export const STATUS_TONE: Record<IncidentStatus, Tone> = {
  open: "critical",
  acknowledged: "serious",
  investigating: "warning",
  identified: "warning",
  monitoring: "info",
  resolved: "good",
};

export function StatusBadge({ status, className }: { status: IncidentStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} icon={STATUS_ICON[status]} className={className}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function StatusIcon({ status, className }: { status: IncidentStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return <Icon className={cn("h-3.5 w-3.5", TONE[STATUS_TONE[status]].text, className)} />;
}

export function PulseDot({ tone = "good", pulse = true, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", className)}>
      {pulse && <span className={cn("absolute inset-0 animate-pulse-ring rounded-full", TONE[tone].dot)} />}
      <span className={cn("relative h-2 w-2 rounded-full", TONE[tone].dot)} />
    </span>
  );
}

/* ───────────── Panel ───────────── */

export function Panel({ className, children, as: As = "section", ...rest }: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" }) {
  return (
    <As className={cn("panel", className)} {...rest}>
      {children}
    </As>
  );
}

export function PanelHeader({ title, description, actions, icon: Icon, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <header className={cn("flex min-h-12 items-start justify-between gap-3 border-b border-hairline px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-ink">
          {Icon && <Icon className="h-3.5 w-3.5 text-ink-subtle" />}
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[12px] leading-snug text-ink-subtle">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}

/* ───────────── Inputs ───────────── */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-[6px] bg-midnight/60 px-2.5 text-[13px] text-ink ring-1 ring-hairline-strong placeholder:text-ink-subtle transition focus:bg-midnight focus:outline-none focus:ring-intel/60",
        className
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-[6px] bg-midnight/60 px-2.5 py-2 text-[13px] leading-relaxed text-ink ring-1 ring-hairline-strong placeholder:text-ink-subtle transition focus:bg-midnight focus:outline-none focus:ring-intel/60",
        className
      )}
      {...props}
    />
  );
});

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select
        className="h-8 w-full appearance-none rounded-[6px] bg-midnight/60 pl-2.5 pr-7 text-[13px] text-ink ring-1 ring-hairline-strong transition focus:outline-none focus:ring-intel/60"
        {...props}
      >
        {children}
      </select>
      <svg className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-subtle" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M3 4.5 6 7.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-[12px] font-medium text-ink-muted", className)} {...props} />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-hairline-strong bg-white/[0.03] px-1 font-sans text-[10.5px] font-medium text-ink-subtle", className)}>
      {children}
    </kbd>
  );
}

/* ───────────── Segmented ───────────── */

export function Segmented<T extends string>({ value, onChange, options, className, size = "sm" }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; title?: string }[]; className?: string; size?: "xs" | "sm" }) {
  return (
    <div role="radiogroup" className={cn("inline-flex items-center gap-0.5 rounded-[7px] bg-midnight/70 p-0.5 ring-1 ring-hairline-strong", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[5px] font-medium transition-colors",
            size === "xs" ? "h-6 px-2 text-[11.5px]" : "h-7 px-2.5 text-[12px]",
            value === o.value ? "bg-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_1px_rgb(148_163_196/0.16)]" : "text-ink-subtle hover:text-ink-muted"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ───────────── Misc ───────────── */

export function Avatar({ name, className, tone }: { name: string; className?: string; tone?: "intel" | "signal" | "neutral" }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
  const palette = ["from-[#6d5ce6] to-[#9d8bff]", "from-[#1b8f9d] to-[#36d6e7]", "from-[#3b4a6b] to-[#5f6f94]", "from-[#7c4dbd] to-[#b18cff]"];
  return (
    <span
      title={name}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[9.5px] font-semibold text-white ring-1 ring-black/40",
        tone === "intel" ? palette[0] : tone === "signal" ? palette[1] : tone === "neutral" ? palette[2] : palette[hue],
        className
      )}
    >
      {name === "Sentinel" ? <SentinelGlyph className="h-3 w-3" /> : initials(name)}
    </span>
  );
}

export function SentinelGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M2 13h4.2l2.3-6.5 3.6 11 2.6-8 1.6 3.5H22" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function EmptyState({ icon: Icon, title, body, action, className }: { icon: LucideIcon; title: string; body?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <div className="relative mb-4">
        <div className="absolute inset-0 -m-3 rounded-full bg-intel/10 blur-xl" />
        <div className="relative flex h-11 w-11 items-center justify-center rounded-[10px] bg-raised ring-1 ring-hairline-strong">
          <Icon className="h-5 w-5 text-ink-muted" />
        </div>
      </div>
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-ink-subtle">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ServiceChip({ id, className, onClick }: { id: string; className?: string; onClick?: () => void }) {
  const C = onClick ? "button" : "span";
  return (
    <C
      onClick={onClick}
      className={cn(
        "inline-flex h-5 items-center rounded-[4px] bg-white/[0.035] px-1.5 font-mono text-[10.5px] text-ink-muted ring-1 ring-inset ring-hairline-strong",
        onClick && "transition hover:bg-white/[0.07] hover:text-ink",
        className
      )}
    >
      {id}
    </C>
  );
}

export function Meter({ value, tone = "neutral", className }: { value: number; tone?: Tone; className?: string }) {
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-700", TONE[tone].dot)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}
