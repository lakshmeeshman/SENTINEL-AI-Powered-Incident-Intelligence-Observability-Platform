"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useSentinel } from "@/lib/store";
import type { Incident } from "@/lib/types";
import { Button, Label, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/overlays";

export function ResolveDialog({ incident, open, onOpenChange }: { incident: Incident; open: boolean; onOpenChange: (v: boolean) => void }) {
  const resolve = useSentinel((s) => s.resolve);
  const [note, setNote] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    resolve(incident.id, note || "Resolved. Metrics back within baseline.");
    toast.success(`${incident.id} resolved`, { description: "Telemetry for affected services will recover over the next few minutes." });
    setNote("");
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Resolve ${incident.id}`} description="Confirm that customer impact has ended. The resolution note goes on the timeline and into the postmortem.">
        <form onSubmit={submit} className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="res-note">Resolution note</Label>
            <Textarea id="res-note" autoFocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What fixed it? For example: rolled back to v4.17.3, error rate back to baseline." />
          </div>
          <div className="flex justify-end gap-2 border-t border-hairline pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              <CheckCircle2 className="h-3.5 w-3.5" /> Resolve incident
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function useIncidentActions() {
  const acknowledge = useSentinel((s) => s.acknowledge);
  const setStatus = useSentinel((s) => s.setStatus);
  return {
    acknowledge: (i: Incident) => {
      acknowledge(i.id);
      toast.success(`${i.id} acknowledged`, { description: "You're now the incident commander." });
    },
    setStatus: (i: Incident, status: Incident["status"]) => {
      setStatus(i.id, status);
      toast.success(`${i.id} status updated`, { description: `Now ${status}.` });
    },
  };
}
