"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Bell, BellOff, CheckCheck, ChevronRight, Keyboard, Menu, Pause, Play, RotateCcw, Settings2, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { useSentinel } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar, Button, Kbd, SEV_TONE, TONE } from "@/components/ui/primitives";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, Popover, PopoverContent, PopoverTrigger, Tip } from "@/components/ui/overlays";
import { SidebarContent } from "./sidebar";
import { useUI } from "./ui-store";

const LABELS: Record<string, string> = { incidents: "Incidents", services: "Service map", logs: "Logs", settings: "Settings", report: "Report" };

function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: { href: string; label: string }[] = [{ href: "/", label: "Overview" }];
  if (parts.length) {
    crumbs.length = 0;
    let href = "";
    parts.forEach((p) => {
      href += `/${p}`;
      crumbs.push({ href, label: LABELS[p] ?? decodeURIComponent(p) });
    });
  }
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
      <Link href="/" className="hidden text-ink-subtle transition hover:text-ink-muted sm:inline">
        Acme Cloud
      </Link>
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex min-w-0 items-center gap-1">
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-ink-faint", i === 0 && "hidden sm:block")} />
          {i === crumbs.length - 1 ? (
            <span className={cn("truncate font-medium text-ink", /^INC-/.test(c.label) && "font-mono text-[12.5px]")} aria-current="page">
              {c.label}
            </span>
          ) : (
            <Link href={c.href} className="truncate text-ink-subtle transition hover:text-ink-muted">
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

export function LiveToggle({ compact }: { compact?: boolean }) {
  const live = useSentinel((s) => s.live);
  const toggle = useSentinel((s) => s.toggleLive);
  return (
    <Tip content={live ? "Pause live telemetry  P" : "Resume live telemetry  P"}>
      <button
        onClick={() => {
          toggle();
          toast(live ? "Live telemetry paused" : "Live telemetry resumed", { description: live ? "Charts are frozen at the current moment." : "Streaming new data every few seconds." });
        }}
        aria-pressed={live}
        className={cn(
          "group inline-flex h-8 items-center gap-2 rounded-[7px] px-2.5 text-[12px] font-medium ring-1 transition",
          live ? "bg-signal/[0.07] text-signal ring-signal/25 hover:bg-signal/[0.12]" : "bg-white/[0.03] text-ink-muted ring-hairline-strong hover:text-ink"
        )}
      >
        <span className="relative flex h-2 w-2">
          {live && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-signal" />}
          <span className={cn("relative h-2 w-2 rounded-full", live ? "bg-signal" : "bg-ink-subtle")} />
        </span>
        {!compact && <span>{live ? "Live" : "Paused"}</span>}
        {live ? <Pause className="h-3 w-3 opacity-60 group-hover:opacity-100" /> : <Play className="h-3 w-3" />}
      </button>
    </Tip>
  );
}

export function useSimulate() {
  const router = useRouter();
  const simulate = useSentinel((s) => s.simulateIncident);
  return (scenarioId?: string, navigate = false) => {
    const inc = simulate(scenarioId);
    if (navigate) router.push(`/incidents/${inc.id}`);
    return inc;
  };
}

function NotificationCenter() {
  const router = useRouter();
  const notifications = useSentinel((s) => s.notifications);
  const now = useSentinel((s) => s.now);
  const markRead = useSentinel((s) => s.markRead);
  const markAll = useSentinel((s) => s.markAllRead);
  const clear = useSentinel((s) => s.clearNotifications);
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <Popover>
      <Tip content="Notifications">
        <PopoverTrigger asChild>
          <button className="relative inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-ink-muted transition hover:bg-white/[0.05] hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="tabular absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-critical px-[3px] text-[9px] font-bold text-white ring-2 ring-midnight">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent className="w-[min(380px,calc(100vw-16px))] p-0">
        <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2.5">
          <p className="text-[13px] font-medium">Notifications</p>
          <div className="flex gap-0.5">
            <Tip content="Mark all as read">
              <button onClick={markAll} className="rounded-[5px] p-1.5 text-ink-subtle transition hover:bg-white/5 hover:text-ink" aria-label="Mark all as read">
                <CheckCheck className="h-3.5 w-3.5" />
              </button>
            </Tip>
            <Tip content="Clear all">
              <button onClick={clear} className="rounded-[5px] p-1.5 text-ink-subtle transition hover:bg-white/5 hover:text-ink" aria-label="Clear notifications">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tip>
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <BellOff className="mb-3 h-5 w-5 text-ink-subtle" />
              <p className="text-[13px] font-medium">You&apos;re all caught up</p>
              <p className="mt-1 text-[12px] text-ink-subtle">New incidents and status changes appear here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {notifications.slice(0, 30).map((n) => {
                const tone = n.severity === "info" ? "good" : SEV_TONE[n.severity];
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => {
                        markRead(n.id);
                        if (n.incidentId) router.push(`/incidents/${n.incidentId}`);
                      }}
                      className="flex w-full gap-3 px-3.5 py-3 text-left transition hover:bg-white/[0.03]"
                    >
                      <span className={cn("mt-1 h-8 w-[3px] shrink-0 rounded-full", TONE[tone].dot, n.read && "opacity-40")} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn("truncate text-[12.5px] font-medium", n.read ? "text-ink-muted" : "text-ink")}>{n.title}</span>
                          {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-intel" aria-label="unread" />}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-ink-subtle">{n.body}</span>
                        <span className="mt-1 block text-[11px] text-ink-faint">{timeAgo(n.t, now || Date.now())}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const router = useRouter();
  const name = useSentinel((s) => s.settings.displayName);
  const reset = useSentinel((s) => s.resetDemo);
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button className="rounded-full outline-offset-2" aria-label="Account menu">
          <Avatar name={name} tone="intel" className="h-7 w-7 text-[10px]" />
        </button>
      </DropdownTrigger>
      <DropdownContent className="w-56">
        <DropdownLabel>{name}</DropdownLabel>
        <DropdownItem onSelect={() => router.push("/settings")}>
          <Settings2 className="h-3.5 w-3.5" /> Settings
        </DropdownItem>
        <DropdownItem onSelect={() => useUI.getState().set({ shortcuts: true })}>
          <Keyboard className="h-3.5 w-3.5" /> Keyboard shortcuts <Kbd className="ml-auto">?</Kbd>
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem
          onSelect={() => {
            reset();
            toast.success("Demo data restored", { description: "Incidents, changes and notifications reset to the original dataset." });
            router.push("/");
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

export function Topbar() {
  const simulate = useSimulate();
  const mobileNav = useUI((s) => s.mobileNav);
  const setUI = useUI((s) => s.set);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-midnight/75 px-3 backdrop-blur-xl sm:px-5">
      <DialogPrimitive.Root open={mobileNav} onOpenChange={(v) => setUI({ mobileNav: v })}>
        <DialogPrimitive.Trigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <Menu className="h-4 w-4" />
          </Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[272px] border-r border-hairline-strong bg-[#090d16] shadow-2xl outline-none data-[state=open]:animate-[fade-in_150ms_ease-out] lg:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
            <SidebarContent onNavigate={() => setUI({ mobileNav: false })} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <LiveToggle compact={false} />
        <Tip content="Simulate an incident  ⇧S">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Simulate an incident"
            onClick={() => simulate()}
          >
            <Zap className="h-4 w-4" />
          </Button>
        </Tip>
        <NotificationCenter />
        <UserMenu />
      </div>
    </header>
  );
}
