"use client";

import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Boxes, CornerDownLeft, FilePlus2, Keyboard, Pause, Play, RotateCcw, Search, Siren, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { SERVICES } from "@/lib/catalog/services";
import { SCENARIOS } from "@/lib/catalog/scenarios";
import { MODE_MAP } from "@/lib/intelligence/knowledge";
import { useSentinel } from "@/lib/store";
import { Kbd, SeverityBadge, StatusIcon } from "@/components/ui/primitives";
import { NAV } from "./sidebar";
import { useUI } from "./ui-store";
import { useSimulate } from "./topbar";

function Item({ onSelect, value, children, shortcut }: { onSelect: () => void; value: string; children: React.ReactNode; shortcut?: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="group flex h-9 cursor-default select-none items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] text-ink-muted data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-ink"
    >
      {children}
      {shortcut && (
        <span className="ml-auto flex gap-0.5 opacity-70">
          {shortcut.split(" ").map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      )}
    </Command.Item>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="px-1.5 pb-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-faint"
    >
      {children}
    </Command.Group>
  );
}

export function CommandPalette() {
  const open = useUI((s) => s.palette);
  const set = useUI((s) => s.set);
  const router = useRouter();
  const incidents = useSentinel((s) => s.incidents);
  const live = useSentinel((s) => s.live);
  const toggleLive = useSentinel((s) => s.toggleLive);
  const reset = useSentinel((s) => s.resetDemo);
  const simulate = useSimulate();

  const run = (fn: () => void) => {
    set({ palette: false });
    setTimeout(fn, 0);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => set({ palette: v })}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#03050a]/65 backdrop-blur-[3px] data-[state=open]:animate-[fade-in_120ms_ease-out]" />
        <DialogPrimitive.Content className="glass fixed left-1/2 top-[11vh] z-50 w-[calc(100vw-24px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-[12px] outline-none data-[state=open]:animate-[dialog-in_160ms_cubic-bezier(0.2,0.9,0.3,1)]">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search incidents, services and actions</DialogPrimitive.Description>
          <Command loop label="Command palette" className="flex max-h-[min(560px,72vh)] flex-col">
            <div className="flex items-center gap-2.5 border-b border-hairline px-4">
              <Search className="h-4 w-4 text-ink-subtle" />
              <Command.Input
                autoFocus
                placeholder="Search incidents, services, actions…"
                className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-subtle"
              />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="flex-1 overflow-y-auto overscroll-contain py-1">
              <Command.Empty className="px-4 py-10 text-center text-[13px] text-ink-subtle">No results. Try an incident ID like INC-2047, or a service name.</Command.Empty>

              <Group heading="Actions">
                <Item value="simulate incident new random" onSelect={() => run(() => simulate(undefined, true))} shortcut="⇧ S">
                  <Zap className="h-4 w-4 text-signal" /> Simulate an incident
                </Item>
                <Item value="declare incident create manual new" onSelect={() => run(() => set({ createIncident: true }))} shortcut="N">
                  <FilePlus2 className="h-4 w-4" /> Declare an incident
                </Item>
                <Item
                  value="pause resume live telemetry stream"
                  onSelect={() =>
                    run(() => {
                      toggleLive();
                      toast(live ? "Live telemetry paused" : "Live telemetry resumed");
                    })
                  }
                  shortcut="P"
                >
                  {live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {live ? "Pause live telemetry" : "Resume live telemetry"}
                </Item>
                <Item value="keyboard shortcuts help" onSelect={() => run(() => set({ shortcuts: true }))} shortcut="?">
                  <Keyboard className="h-4 w-4" /> Keyboard shortcuts
                </Item>
                <Item
                  value="reset demo data restore dataset"
                  onSelect={() =>
                    run(() => {
                      reset();
                      toast.success("Demo data restored");
                      router.push("/");
                    })
                  }
                >
                  <RotateCcw className="h-4 w-4" /> Reset demo data
                </Item>
              </Group>

              <Group heading="Go to">
                {NAV.flatMap((g) => g.items).map((n) => (
                  <Item key={n.href} value={`go ${n.label}`} onSelect={() => run(() => router.push(n.href))} shortcut={n.shortcut}>
                    <n.icon className="h-4 w-4" /> {n.label}
                  </Item>
                ))}
              </Group>

              <Group heading="Incidents">
                {incidents.slice(0, 40).map((i) => (
                  <Item key={i.id} value={`${i.id} ${i.title} ${i.severity} ${i.status}`} onSelect={() => run(() => router.push(`/incidents/${i.id}`))}>
                    <StatusIcon status={i.status} />
                    <span className="font-mono text-[11.5px] text-ink-subtle">{i.id}</span>
                    <span className="truncate">{i.title}</span>
                    <span className="ml-auto pl-2">
                      <SeverityBadge severity={i.severity} />
                    </span>
                  </Item>
                ))}
              </Group>

              <Group heading="Services">
                {SERVICES.map((s) => (
                  <Item key={s.id} value={`service ${s.id} ${s.team} ${s.runtime}`} onSelect={() => run(() => router.push(`/services?service=${s.id}`))}>
                    <Boxes className="h-4 w-4" />
                    <span className="font-mono text-[12px]">{s.id}</span>
                    <span className="text-[12px] text-ink-subtle">{s.team}</span>
                  </Item>
                ))}
              </Group>

              <Group heading="Simulate a specific failure">
                {SCENARIOS.map((sc) => (
                  <Item key={sc.id} value={`simulate scenario ${sc.id} ${MODE_MAP[sc.id]?.label ?? ""} ${sc.origin}`} onSelect={() => run(() => simulate(sc.id, true))}>
                    <Siren className="h-4 w-4 text-ink-subtle" />
                    <span>{MODE_MAP[sc.id]?.label ?? sc.id}</span>
                    <span className="font-mono text-[11px] text-ink-subtle">{sc.origin}</span>
                  </Item>
                ))}
              </Group>
            </Command.List>
            <div className="flex items-center gap-4 border-t border-hairline px-4 py-2 text-[11px] text-ink-subtle">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>
                  <CornerDownLeft className="h-2.5 w-2.5" />
                </Kbd>
                select
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-intel" /> Sentinel
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
