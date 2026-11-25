"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SERVICES, PEOPLE } from "@/lib/catalog/services";
import { useSentinel } from "@/lib/store";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, Input, Label, Segmented, Select, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { useUI } from "@/components/shell/ui-store";

const SEV_HELP: Record<Severity, string> = {
  "SEV-1": "Critical: customer-facing outage or data at risk",
  "SEV-2": "Major: significant degradation for many users",
  "SEV-3": "Minor: limited impact, workaround exists",
  "SEV-4": "Low: cosmetic or internal only",
};

export function CreateIncidentDialog() {
  const open = useUI((s) => s.createIncident);
  const set = useUI((s) => s.set);
  const router = useRouter();
  const create = useSentinel((s) => s.createIncident);
  const me = useSentinel((s) => s.settings.displayName);

  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<Severity>("SEV-3");
  const [services, setServices] = useState<string[]>([]);
  const [started, setStarted] = useState("5");
  const [commander, setCommander] = useState("me");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);

  const reset = () => {
    setTitle("");
    setSeverity("SEV-3");
    setServices([]);
    setStarted("5");
    setCommander("me");
    setDescription("");
    setTouched(false);
  };

  const valid = title.trim().length >= 6;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    const inc = create({
      title,
      severity,
      description: description || "Declared manually. No description provided yet.",
      services,
      startedMinutesAgo: Number(started),
      commander: commander === "none" ? undefined : commander === "me" ? me : commander,
    });
    toast.success(`${inc.id} declared`, { description: inc.title });
    set({ createIncident: false });
    reset();
    router.push(`/incidents/${inc.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => set({ createIncident: v })}>
      <DialogContent title="Declare an incident" description="Open an incident for an issue that monitoring hasn't caught, such as a customer report. Sentinel will check telemetry for corroborating evidence." className="max-w-xl">
        <form onSubmit={submit} className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="inc-title">Title</Label>
            <Input id="inc-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Checkout is slow for EU customers" aria-invalid={touched && !valid} />
            {touched && !valid && <p className="mt-1 text-[11.5px] text-[#ff8da0]">Give the incident a descriptive title (at least 6 characters).</p>}
          </div>
          <div>
            <Label>Severity</Label>
            <Segmented
              value={severity}
              onChange={setSeverity}
              options={(["SEV-1", "SEV-2", "SEV-3", "SEV-4"] as Severity[]).map((s) => ({ value: s, label: s, title: SEV_HELP[s] }))}
            />
            <p className="mt-1.5 text-[11.5px] text-ink-subtle">{SEV_HELP[severity]}</p>
          </div>
          <div>
            <Label>Affected services</Label>
            <div className="flex flex-wrap gap-1.5">
              {SERVICES.map((s) => {
                const on = services.includes(s.id);
                return (
                  <button
                    type="button"
                    key={s.id}
                    aria-pressed={on}
                    onClick={() => setServices((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                    className={cn(
                      "h-6 rounded-[5px] px-2 font-mono text-[11px] ring-1 ring-inset transition",
                      on ? "bg-intel/15 text-intel-bright ring-intel/40" : "bg-white/[0.02] text-ink-subtle ring-hairline-strong hover:text-ink-muted"
                    )}
                  >
                    {s.id}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="inc-start">Impact started</Label>
              <Select id="inc-start" value={started} onChange={(e) => setStarted(e.target.value)}>
                <option value="0">Just now</option>
                <option value="5">About 5 minutes ago</option>
                <option value="15">About 15 minutes ago</option>
                <option value="30">About 30 minutes ago</option>
                <option value="60">About an hour ago</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="inc-cmd">Incident commander</Label>
              <Select id="inc-cmd" value={commander} onChange={(e) => setCommander(e.target.value)}>
                <option value="me">Me ({me})</option>
                <option value="none">Unassigned</option>
                {PEOPLE.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.team})
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="inc-desc">What are you seeing?</Label>
            <Textarea id="inc-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Symptoms, who reported it, links to tickets…" />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
            <Button variant="ghost" onClick={() => set({ createIncident: false })}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Declare incident
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
