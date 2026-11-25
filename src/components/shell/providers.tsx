"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import { useSentinel } from "@/lib/store";
import { isTypingTarget } from "@/lib/hooks";
import type { Severity } from "@/lib/types";
import { TooltipProvider } from "@/components/ui/overlays";
import { useUI } from "./ui-store";

const SEV_RANK: Record<Severity, number> = { "SEV-1": 1, "SEV-2": 2, "SEV-3": 3, "SEV-4": 4 };

/** boots persisted state, drives the live clock, and runs chaos mode */
function SimulationDriver() {
  const tickMs = useSentinel((s) => s.settings.tickMs);
  const hydrated = useSentinel((s) => s.hydrated);
  const lastChaos = useRef(Date.now());

  useEffect(() => {
    Promise.resolve(useSentinel.persist.rehydrate()).finally(() => useSentinel.getState().boot());
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const id = setInterval(() => {
      const s = useSentinel.getState();
      s.tick();
      if (s.live && s.settings.chaosMode) {
        const activeSim = s.incidents.filter((i) => i.status !== "resolved" && i.sim).length;
        const due = Date.now() - lastChaos.current > s.settings.chaosEveryMin * 60_000;
        if (due && activeSim < 6) {
          lastChaos.current = Date.now();
          s.simulateIncident();
        }
      }
    }, tickMs);
    return () => clearInterval(id);
  }, [hydrated, tickMs]);

  return null;
}

/** turns new incident notifications into toasts */
function NotificationToaster() {
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  const notifications = useSentinel((s) => s.notifications);
  const hydrated = useSentinel((s) => s.hydrated);
  const threshold = useSentinel((s) => s.settings.toastSeverity);

  useEffect(() => {
    if (!hydrated) return;
    if (!seen.current) {
      seen.current = new Set(notifications.map((n) => n.id));
      return;
    }
    for (const n of notifications) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.severity === "info") continue;
      if (SEV_RANK[n.severity] > SEV_RANK[threshold]) continue;
      const fn = n.severity === "SEV-1" || n.severity === "SEV-2" ? toast.error : toast.warning;
      fn(n.title, {
        description: n.body,
        duration: 7000,
        action: n.incidentId ? { label: "View", onClick: () => router.push(`/incidents/${n.incidentId}`) } : undefined,
      });
    }
  }, [notifications, hydrated, threshold, router]);
  return null;
}

function ReduceMotion() {
  const reduce = useSentinel((s) => s.settings.reduceMotion);
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduce);
  }, [reduce]);
  return null;
}

/** global keyboard shortcuts */
function Shortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const pendingG = useRef<number>(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.set({ palette: !ui.palette });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (ui.palette || ui.createIncident || ui.shortcuts) return;
      if (document.querySelector("[role=dialog]")) return;

      const k = e.key;
      if (Date.now() - pendingG.current < 1200) {
        pendingG.current = 0;
        const dest: Record<string, string> = { o: "/", i: "/incidents", m: "/services", l: "/logs", s: "/settings" };
        if (dest[k.toLowerCase()]) {
          e.preventDefault();
          router.push(dest[k.toLowerCase()]!);
        }
        return;
      }
      if (k === "g") {
        pendingG.current = Date.now();
        return;
      }
      if (k === "?") {
        e.preventDefault();
        ui.set({ shortcuts: true });
      } else if (k === "n") {
        e.preventDefault();
        ui.set({ createIncident: true });
      } else if (k === "S" && e.shiftKey) {
        e.preventDefault();
        const inc = useSentinel.getState().simulateIncident();
        router.push(`/incidents/${inc.id}`);
      } else if (k === "p") {
        const s = useSentinel.getState();
        s.toggleLive();
        toast(s.live ? "Live telemetry paused" : "Live telemetry resumed");
      } else if (k === "[") {
        const s = useSentinel.getState();
        s.updateSettings({ sidebarCollapsed: !s.settings.sidebarCollapsed });
      } else if (k === "/") {
        const el = document.querySelector<HTMLInputElement>("[data-page-search]");
        if (el) {
          e.preventDefault();
          el.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={250}>
      <SimulationDriver />
      <NotificationToaster />
      <ReduceMotion />
      <Shortcuts />
      {children}
      <Toaster
        theme="dark"
        position="bottom-right"
        offset={18}
        gap={8}
        toastOptions={{
          classNames: {
            toast: "!bg-[#111622]/95 !backdrop-blur-xl !border !border-[rgb(148_163_196/0.16)] !text-ink !rounded-[10px] !shadow-2xl !font-sans",
            title: "!text-[13px] !font-medium",
            description: "!text-[12px] !text-ink-muted",
            actionButton: "!bg-intel !text-white !rounded-[6px] !text-[12px]",
          },
        }}
      />
    </TooltipProvider>
  );
}
