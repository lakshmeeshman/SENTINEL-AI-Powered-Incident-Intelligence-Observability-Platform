"use client";

import { useEffect, useState } from "react";
import { BellRing, BrainCircuit, Cpu, Database, Download, Keyboard, Monitor, RotateCcw, Sparkles, Trash2, User, Zap, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { fetchAiStatus, type AiStatus } from "@/lib/intelligence/client";
import { STORAGE_KEY, kv } from "@/lib/persistence/storage";
import { useSentinel } from "@/lib/store";
import type { Severity, TimeRange } from "@/lib/types";
import { downloadText } from "@/lib/utils";
import { Page, PageHeader } from "@/components/ui/page";
import { Badge, Button, Input, Panel, Segmented, Select, Skeleton } from "@/components/ui/primitives";
import { Dialog, DialogContent, Switch } from "@/components/ui/overlays";
import { useUI } from "@/components/shell/ui-store";

function Section({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: React.ReactNode }) {
  return (
    <Panel className="grid gap-0 md:grid-cols-[280px_minmax(0,1fr)]">
      <div className="border-b border-hairline px-5 py-4 md:border-b-0 md:border-r">
        <h2 className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
          <Icon className="h-4 w-4 text-ink-subtle" /> {title}
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-subtle">{description}</p>
      </div>
      <div className="divide-y divide-hairline">{children}</div>
    </Panel>
  );
}

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[13px] text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] leading-snug text-ink-subtle">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const ready = useSentinel((s) => s.hydrated);
  const settings = useSentinel((s) => s.settings);
  const update = useSentinel((s) => s.updateSettings);
  const live = useSentinel((s) => s.live);
  const setLive = useSentinel((s) => s.setLive);
  const reset = useSentinel((s) => s.resetDemo);
  const notify = useSentinel((s) => s.notify);
  const clearAnalyses = useSentinel((s) => s.clearAnalyses);
  const analysesCount = useSentinel((s) => Object.keys(s.analyses).length);
  const incidentCount = useSentinel((s) => s.incidents.length);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [name, setName] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [bytes, setBytes] = useState(0);

  useEffect(() => {
    fetchAiStatus(true).then(setAi);
  }, []);
  useEffect(() => {
    if (ready) setName(settings.displayName);
  }, [ready, settings.displayName]);
  useEffect(() => {
    setBytes((kv.getItem(STORAGE_KEY) ?? "").length);
  }, [incidentCount, analysesCount, settings]);

  if (!ready) {
    return (
      <Page>
        <Skeleton className="mb-5 h-8 w-40" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="mb-4 h-40 w-full" />
        ))}
      </Page>
    );
  }

  return (
    <Page className="max-w-[1100px]">
      <PageHeader title="Settings" description="Workspace preferences for this browser. Everything is stored locally, so nothing leaves your machine unless you configure an AI key on the server." />
      <div className="space-y-4">
        <Section icon={User} title="Profile" description="How you appear on incident timelines and as incident commander.">
          <Row label="Display name" hint="Used when you acknowledge incidents, post updates or resolve.">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                update({ displayName: name.trim() });
                toast.success("Display name saved");
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} className="w-52" aria-label="Display name" />
              <Button type="submit" variant="secondary" disabled={!name.trim() || name.trim() === settings.displayName}>
                Save
              </Button>
            </form>
          </Row>
        </Section>

        <Section icon={Zap} title="Live simulation" description="Sentinel simulates a production estate. Telemetry, logs and events are generated deterministically from time and the incidents in play.">
          <Row label="Stream live telemetry" hint="Pause to freeze every chart at the current moment. Shortcut: P">
            <Switch checked={live} onCheckedChange={(v) => setLive(v)} aria-label="Stream live telemetry" />
          </Row>
          <Row label="Refresh interval" hint="How often new telemetry arrives.">
            <Segmented
              value={String(settings.tickMs)}
              onChange={(v) => update({ tickMs: Number(v) })}
              options={[
                { value: "2000", label: "2s" },
                { value: "3000", label: "3s" },
                { value: "5000", label: "5s" },
                { value: "10000", label: "10s" },
              ]}
            />
          </Row>
          <Row label="Default time range" hint="Used by the overview when it opens.">
            <Segmented value={settings.defaultRange} onChange={(v) => update({ defaultRange: v as TimeRange })} options={(["15m", "1h", "6h", "24h"] as TimeRange[]).map((r) => ({ value: r, label: r }))} />
          </Row>
          <Row label="Chaos mode" hint="Inject a random failure periodically, so you can watch detection and response without lifting a finger.">
            <div className="flex items-center gap-3">
              <Select value={String(settings.chaosEveryMin)} onChange={(e) => update({ chaosEveryMin: Number(e.target.value) })} className="w-32" aria-label="Chaos frequency" disabled={!settings.chaosMode}>
                <option value="2">Every 2 min</option>
                <option value="4">Every 4 min</option>
                <option value="8">Every 8 min</option>
                <option value="15">Every 15 min</option>
              </Select>
              <Switch
                checked={settings.chaosMode}
                onCheckedChange={(v) => {
                  update({ chaosMode: v });
                  toast(v ? "Chaos mode on" : "Chaos mode off", { description: v ? `A random failure will be injected every ${settings.chaosEveryMin} minutes.` : undefined });
                }}
                aria-label="Chaos mode"
              />
            </div>
          </Row>
        </Section>

        <Section icon={BrainCircuit} title="Intelligence" description="Root-cause analysis always runs on Sentinel's deterministic engine. With an Anthropic API key, Claude writes the narrative from the same measured evidence.">
          <Row
            label="Analysis provider"
            hint={
              ai?.enabled ? (
                <>Claude is configured on the server. Narratives are AI-written; scores, anomalies and impact are still measured by Sentinel.</>
              ) : (
                <>
                  No key configured. Add <code className="rounded bg-white/5 px-1 font-mono text-[11.5px]">ANTHROPIC_API_KEY</code> to <code className="rounded bg-white/5 px-1 font-mono text-[11.5px]">.env.local</code> (or your Vercel project) and restart.
                </>
              )
            }
          >
            {!ai ? (
              <Skeleton className="h-6 w-40" />
            ) : ai.enabled ? (
              <Badge tone="info" icon={Sparkles} className="h-6 bg-intel/15 px-2 text-intel-bright ring-intel/35">
                Claude · {ai.model}
              </Badge>
            ) : (
              <Badge tone="neutral" icon={Cpu} className="h-6 px-2">
                Demo intelligence{ai.reachable ? "" : " (offline)"}
              </Badge>
            )}
          </Row>
          <Row label="Prefer Claude when available" hint="Turn off to always use the deterministic engine, for example to compare outputs.">
            <Switch checked={settings.preferAi} onCheckedChange={(v) => update({ preferAi: v })} aria-label="Prefer Claude" />
          </Row>
          <Row label="Cached analyses" hint={`${analysesCount} incident${analysesCount === 1 ? "" : "s"} analysed. Clearing makes each incident re-run its analysis when opened.`}>
            <Button
              variant="outline"
              disabled={!analysesCount}
              onClick={() => {
                clearAnalyses();
                toast.success("Analysis cache cleared");
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear cache
            </Button>
          </Row>
        </Section>

        <Section icon={BellRing} title="Notifications" description="Toasts for new incidents. Everything also lands in the notification center.">
          <Row label="Show toasts for" hint="Incidents below this severity only appear in the notification center.">
            <Select value={settings.toastSeverity} onChange={(e) => update({ toastSeverity: e.target.value as Severity })} className="w-44" aria-label="Toast threshold">
              <option value="SEV-1">SEV-1 only</option>
              <option value="SEV-2">SEV-2 and above</option>
              <option value="SEV-3">SEV-3 and above</option>
              <option value="SEV-4">All severities</option>
            </Select>
          </Row>
          <Row label="Test notifications" hint="Sends a sample notification through the same pipeline as real incidents.">
            <Button
              variant="secondary"
              onClick={() => {
                notify({ title: "Test notification", body: "Notifications are working. This is what a new incident looks like.", severity: settings.toastSeverity });
              }}
            >
              <BellRing className="h-3.5 w-3.5" /> Send test
            </Button>
          </Row>
        </Section>

        <Section icon={Monitor} title="Interface" description="Accessibility and layout preferences.">
          <Row label="Reduce motion" hint="Disables pulses, chart transitions and streaming effects. Sentinel also respects your OS setting.">
            <Switch checked={settings.reduceMotion} onCheckedChange={(v) => update({ reduceMotion: v })} aria-label="Reduce motion" />
          </Row>
          <Row label="Collapse sidebar" hint="Icon-only navigation. Shortcut: [">
            <Switch checked={settings.sidebarCollapsed} onCheckedChange={(v) => update({ sidebarCollapsed: v })} aria-label="Collapse sidebar" />
          </Row>
          <Row label="Keyboard shortcuts" hint="Press ? anywhere to see them.">
            <Button variant="secondary" onClick={() => useUI.getState().set({ shortcuts: true })}>
              <Keyboard className="h-3.5 w-3.5" /> View shortcuts
            </Button>
          </Row>
          <Row label="Welcome tour" hint="Replay the three-step introduction.">
            <Button variant="secondary" onClick={() => update({ onboarded: false })}>
              Replay tour
            </Button>
          </Row>
        </Section>

        <Section icon={Database} title="Demo data" description="The workspace is persisted in this browser through a storage adapter (localStorage today; swappable for an API or database).">
          <Row label="Stored workspace" hint={`${incidentCount} incidents, ${analysesCount} analyses, ${(bytes / 1024).toFixed(1)} KB in local storage.`}>
            <Button
              variant="secondary"
              onClick={() => {
                const s = useSentinel.getState();
                downloadText(
                  `sentinel-workspace-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify({ exportedAt: new Date().toISOString(), incidents: s.incidents, changes: s.changes, analyses: s.analyses, notifications: s.notifications, settings: s.settings }, null, 2),
                  "application/json"
                );
                toast.success("Workspace exported");
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export JSON
            </Button>
          </Row>
          <Row label="Reset demo dataset" hint="Restores the original incidents, changes and notifications, re-anchored to the current time. Your profile and preferences are kept.">
            <Button variant="danger" onClick={() => setConfirmReset(true)}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
            </Button>
          </Row>
        </Section>
      </div>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent title="Reset demo data?" description="Incidents you created or simulated, timeline notes and cached analyses will be replaced with the original demo dataset.">
          <div className="flex justify-end gap-2 px-5 py-4">
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                reset();
                setConfirmReset(false);
                toast.success("Demo data restored", { description: "11 incidents re-anchored to now." });
              }}
            >
              Reset demo data
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
