"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, BrainCircuit, Network } from "lucide-react";
import { useSentinel } from "@/lib/store";
import { Button, Kbd } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { SentinelMark } from "./brand";
import { useUI } from "./ui-store";
import { useSimulate } from "./topbar";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "Open command palette" },
  { keys: ["?"], label: "Show keyboard shortcuts" },
  { keys: ["G", "O"], label: "Go to Overview" },
  { keys: ["G", "I"], label: "Go to Incidents" },
  { keys: ["G", "M"], label: "Go to Service map" },
  { keys: ["G", "L"], label: "Go to Logs" },
  { keys: ["G", "S"], label: "Go to Settings" },
  { keys: ["N"], label: "Declare an incident" },
  { keys: ["⇧", "S"], label: "Simulate an incident" },
  { keys: ["P"], label: "Pause or resume live telemetry" },
  { keys: ["["], label: "Collapse or expand the sidebar" },
  { keys: ["/"], label: "Focus search on the current page" },
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcuts);
  const set = useUI((s) => s.set);
  return (
    <Dialog open={open} onOpenChange={(v) => set({ shortcuts: v })}>
      <DialogContent title="Keyboard shortcuts" description="Sentinel is built to be driven from the keyboard during an incident.">
        <ul className="divide-y divide-hairline px-5 py-2">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between py-2.5 text-[13px] text-ink-muted">
              {s.label}
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k} className="h-5 min-w-5 text-[11px]">
                    {k}
                  </Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

const STEPS = [
  {
    icon: Activity,
    title: "A production estate, live",
    body: "Sentinel is watching 13 services in Acme Cloud's production environment. Telemetry streams every few seconds, and three incidents are already in progress.",
  },
  {
    icon: BrainCircuit,
    title: "Root cause, from evidence",
    body: "Open any incident and Sentinel analyses metrics, logs, the dependency graph and recent changes to explain what broke, how confident it is, and what to do next.",
  },
  {
    icon: Network,
    title: "Break something",
    body: "Simulate a failure and watch it propagate across the service map, fill the logs and get diagnosed. Reset the demo dataset from Settings at any time.",
  },
];

export function OnboardingDialog() {
  const onboarded = useSentinel((s) => s.settings.onboarded);
  const hydrated = useSentinel((s) => s.hydrated);
  const update = useSentinel((s) => s.updateSettings);
  const router = useRouter();
  const simulate = useSimulate();
  const [step, setStep] = useState(0);
  const open = hydrated && !onboarded;
  const done = () => update({ onboarded: true });
  const S = STEPS[step]!;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && done()}>
      <DialogContent className="max-w-md overflow-hidden" hideClose>
        <div className="relative px-6 pb-5 pt-7">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(139_124_246/0.22),transparent)]" />
          <div className="relative flex items-center gap-2.5">
            <SentinelMark animated />
            <span className="text-[13px] font-medium text-ink-muted">Welcome to Sentinel</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="relative mt-6">
              <S.icon className="h-5 w-5 text-intel-bright" />
              <h2 className="mt-3 text-[19px] font-semibold tracking-[-0.02em] text-ink">{S.title}</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{S.body}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex items-center justify-between border-t border-hairline px-6 py-3.5">
          <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1 rounded-full transition-all ${i === step ? "w-5 bg-intel" : "w-1.5 bg-white/15"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {step < STEPS.length - 1 ? (
              <>
                <Button variant="ghost" onClick={done}>
                  Skip
                </Button>
                <Button variant="primary" onClick={() => setStep(step + 1)}>
                  Next
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    done();
                    router.push("/incidents/INC-2047");
                  }}
                >
                  Open live incident
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    done();
                    simulate(undefined, true);
                  }}
                >
                  Simulate a failure
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
