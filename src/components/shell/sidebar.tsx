"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, Network, PanelLeftClose, PanelLeftOpen, ScrollText, Search, Settings2, Siren, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { useSentinel } from "@/lib/store";
import { usePlatformHealth } from "@/lib/hooks";
import { scoreLabel, scoreTone, statusTone } from "@/lib/analytics/health";
import { cn } from "@/lib/utils";
import { Avatar, Kbd, PulseDot, TONE } from "@/components/ui/primitives";
import { Tip } from "@/components/ui/overlays";
import { SentinelMark, Wordmark } from "./brand";
import { useUI } from "./ui-store";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
  shortcut: string;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Monitor",
    items: [
      { href: "/", label: "Overview", icon: Gauge, match: (p) => p === "/", shortcut: "G O" },
      { href: "/services", label: "Service map", icon: Network, match: (p) => p.startsWith("/services"), shortcut: "G M" },
      { href: "/logs", label: "Logs", icon: ScrollText, match: (p) => p.startsWith("/logs"), shortcut: "G L" },
    ],
  },
  {
    group: "Respond",
    items: [{ href: "/incidents", label: "Incidents", icon: Siren, match: (p) => p.startsWith("/incidents") || p.startsWith("/report"), shortcut: "G I" }],
  },
  {
    group: "Workspace",
    items: [{ href: "/settings", label: "Settings", icon: Settings2, match: (p) => p.startsWith("/settings"), shortcut: "G S" }],
  },
];

export function SidebarContent({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const incidents = useSentinel((s) => s.incidents);
  const settings = useSentinel((s) => s.settings);
  const live = useSentinel((s) => s.live);
  const hydrated = useSentinel((s) => s.hydrated);
  const update = useSentinel((s) => s.updateSettings);
  const openPalette = () => useUI.getState().set({ palette: true });
  const health = usePlatformHealth();
  const active = incidents.filter((i) => i.status !== "resolved");
  const urgent = active.some((i) => i.severity === "SEV-1" || i.severity === "SEV-2");

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5" aria-label="Sentinel home">
          <SentinelMark />
          {!collapsed && <Wordmark />}
        </Link>
        {!collapsed && (
          <span className="ml-auto rounded-[4px] bg-white/[0.04] px-1.5 py-0.5 text-[10.5px] font-medium text-ink-subtle ring-1 ring-inset ring-hairline-strong">acme-prod</span>
        )}
      </div>

      <div className={cn("px-3 pb-2", collapsed && "px-2")}>
        <button
          onClick={() => {
            onNavigate?.();
            openPalette();
          }}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-[7px] bg-white/[0.025] px-2.5 text-[12.5px] text-ink-subtle ring-1 ring-hairline-strong transition hover:bg-white/[0.05] hover:text-ink-muted",
            collapsed && "justify-center px-0"
          )}
          aria-label="Search or run a command"
        >
          <Search className="h-3.5 w-3.5" />
          {!collapsed && (
            <>
              <span>Search or jump to</span>
              <span className="ml-auto flex gap-0.5">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </span>
            </>
          )}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
        {NAV.map((g) => (
          <div key={g.group} className="mb-4">
            {!collapsed && <p className="px-2 pb-1.5 text-[11px] font-medium text-ink-faint">{g.group}</p>}
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const on = item.match(pathname);
                const Icon = item.icon;
                const link = (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "group relative flex h-8 items-center gap-2.5 rounded-[7px] px-2 text-[13px] transition-colors",
                      on ? "bg-white/[0.055] text-ink" : "text-ink-muted hover:bg-white/[0.03] hover:text-ink",
                      collapsed && "justify-center px-0"
                    )}
                  >
                    {on && <motion.span layoutId="nav-active" className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-intel" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                    <Icon className={cn("h-4 w-4 shrink-0", on ? "text-intel-bright" : "text-ink-subtle group-hover:text-ink-muted")} strokeWidth={1.8} />
                    {!collapsed && <span>{item.label}</span>}
                    {item.href === "/incidents" && hydrated && active.length > 0 && (
                      <span
                        className={cn(
                          "tabular ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold",
                          urgent ? "bg-critical/18 text-[#ff8da0] ring-1 ring-critical/30" : "bg-white/[0.06] text-ink-muted",
                          collapsed && "absolute -right-0.5 -top-0.5 ml-0 h-4 min-w-4 text-[9.5px]"
                        )}
                      >
                        {active.length}
                      </span>
                    )}
                  </Link>
                );
                return <li key={item.href}>{collapsed ? <Tip content={item.label} side="right">{link}</Tip> : link}</li>;
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("space-y-2 border-t border-hairline p-3", collapsed && "px-2")}>
        {health && !collapsed && (
          <Link href="/" onClick={onNavigate} className="block rounded-[8px] bg-white/[0.02] p-2.5 ring-1 ring-hairline transition hover:bg-white/[0.04]">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-ink-subtle">Platform health</span>
              <span className={cn("tabular text-[12px] font-semibold", TONE[scoreTone(health.score)].text)}>{health.score}</span>
            </div>
            <div className="mt-2 flex gap-[3px]" aria-label="Service status strip">
              {health.health.map((h) => (
                <span key={h.id} title={`${h.id}: ${h.status}`} className={cn("h-3 flex-1 rounded-[2px] opacity-85", TONE[statusTone(h.status)].dot, h.status === "healthy" && "opacity-55")} />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-subtle">{scoreLabel(health.score)}</p>
          </Link>
        )}
        <div className={cn("flex items-center gap-2.5 px-1", collapsed && "justify-center px-0")}>
          <Avatar name={settings.displayName} tone="intel" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-ink">{settings.displayName}</p>
              <p className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                <PulseDot tone={live ? "good" : "neutral"} pulse={false} className="h-1.5 w-1.5 [&>span]:h-1.5 [&>span]:w-1.5" />
                On call, Platform
              </p>
            </div>
          )}
          {!onNavigate && (
            <Tip content={collapsed ? "Expand sidebar  [" : "Collapse sidebar  ["} side="right">
              <button
                onClick={() => update({ sidebarCollapsed: !collapsed })}
                className={cn("rounded-[5px] p-1 text-ink-subtle transition hover:bg-white/5 hover:text-ink", collapsed && "hidden")}
                aria-label="Toggle sidebar"
              >
                {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </Tip>
          )}
        </div>
        {collapsed && (
          <button onClick={() => update({ sidebarCollapsed: false })} className="mx-auto flex rounded-[5px] p-1 text-ink-subtle transition hover:bg-white/5 hover:text-ink" aria-label="Expand sidebar">
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const collapsed = useSentinel((s) => s.settings.sidebarCollapsed);
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 border-r border-hairline bg-[#090d16]/80 backdrop-blur-xl transition-[width] duration-200 lg:block",
        collapsed ? "w-[60px]" : "w-[236px]"
      )}
    >
      <SidebarContent collapsed={collapsed} />
    </aside>
  );
}
