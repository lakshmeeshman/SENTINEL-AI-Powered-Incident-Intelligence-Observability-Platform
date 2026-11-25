"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { STORAGE_KEY, zustandStorage } from "@/lib/persistence/storage";
import { buildSeed } from "@/lib/sim/seed";
import { createManualIncident, createSimulatedIncident, eid, type ManualIncidentInput } from "@/lib/sim/factory";
import type { Analysis, AppNotification, ChangeEvent, Incident, IncidentStatus, Settings, Severity, TimelineEvent } from "@/lib/types";

export const DEFAULT_SETTINGS: Settings = {
  displayName: "Alex Morgan",
  handle: "@alex",
  tickMs: 3000,
  chaosMode: false,
  chaosEveryMin: 4,
  toastSeverity: "SEV-3",
  preferAi: true,
  reduceMotion: false,
  onboarded: false,
  sidebarCollapsed: false,
  defaultRange: "1h",
};

export const STATUS_ORDER: IncidentStatus[] = ["open", "acknowledged", "investigating", "identified", "monitoring", "resolved"];
export const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

interface PersistedState {
  incidents: Incident[];
  changes: ChangeEvent[];
  notifications: AppNotification[];
  analyses: Record<string, Analysis>;
  settings: Settings;
  seededAt: number;
}

interface RuntimeState {
  hydrated: boolean;
  now: number;
  live: boolean;
}

interface Actions {
  boot(): void;
  tick(): void;
  setLive(v: boolean): void;
  toggleLive(): void;
  simulateIncident(scenarioId?: string): Incident;
  createIncident(input: Omit<ManualIncidentInput, "reporter">): Incident;
  acknowledge(id: string): void;
  setStatus(id: string, status: IncidentStatus, note?: string): void;
  resolve(id: string, note: string): void;
  setSeverity(id: string, sev: Severity): void;
  addNote(id: string, text: string, type?: "note" | "action"): void;
  saveAnalysis(a: Analysis): void;
  toggleActionDone(incidentId: string, action: string): void;
  markRead(id: string): void;
  markAllRead(): void;
  clearNotifications(): void;
  updateSettings(patch: Partial<Settings>): void;
  resetDemo(): void;
}

export type SentinelState = PersistedState & RuntimeState & Actions;

const ev = (type: TimelineEvent["type"], actor: string, message: string, at = Date.now()): TimelineEvent => ({ id: eid("tl"), at, type, actor, message });

function notif(n: Omit<AppNotification, "id" | "read" | "t"> & { t?: number }): AppNotification {
  return { id: eid("n"), read: false, t: n.t ?? Date.now(), ...n };
}

export const useSentinel = create<SentinelState>()(
  persist(
    (set, get) => {
      const patchIncident = (id: string, fn: (i: Incident) => Incident) =>
        set((s) => ({ incidents: s.incidents.map((i) => (i.id === id ? fn(i) : i)) }));
      const me = () => get().settings.displayName;

      return {
        hydrated: false,
        now: 0,
        live: true,
        incidents: [],
        changes: [],
        notifications: [],
        analyses: {},
        settings: DEFAULT_SETTINGS,
        seededAt: 0,

        boot() {
          const s = get();
          const now = Date.now();
          if (!s.seededAt || !s.incidents.length) {
            const seed = buildSeed(now);
            set({ ...seed, analyses: {}, seededAt: now });
          }
          set({ hydrated: true, now, live: true });
        },
        tick() {
          if (get().live) set({ now: Date.now() });
        },
        setLive(v) {
          set({ live: v, now: Date.now() });
        },
        toggleLive() {
          get().setLive(!get().live);
        },

        simulateIncident(scenarioId) {
          const now = Date.now();
          const { incident, change } = createSimulatedIncident({ now, incidents: get().incidents, scenarioId });
          set((s) => ({
            now,
            incidents: [incident, ...s.incidents],
            changes: change ? [change, ...s.changes] : s.changes,
            notifications: [
              notif({ title: `${incident.id} opened (${incident.severity})`, body: incident.title, severity: incident.severity, incidentId: incident.id }),
              ...s.notifications,
            ].slice(0, 60),
          }));
          return incident;
        },

        createIncident(input) {
          const now = Date.now();
          const incident = createManualIncident({ ...input, reporter: me() }, now, get().incidents);
          set((s) => ({
            now,
            incidents: [incident, ...s.incidents],
            notifications: [
              notif({ title: `${incident.id} declared (${incident.severity})`, body: incident.title, severity: incident.severity, incidentId: incident.id }),
              ...s.notifications,
            ].slice(0, 60),
          }));
          return incident;
        },

        acknowledge(id) {
          const now = Date.now();
          patchIncident(id, (i) =>
            i.acknowledgedAt && i.status !== "open"
              ? i
              : {
                  ...i,
                  status: i.status === "open" ? "acknowledged" : i.status,
                  acknowledgedAt: i.acknowledgedAt ?? now,
                  commander: i.commander ?? me(),
                  timeline: [...i.timeline, ev("acknowledged", me(), `Acknowledged. ${i.commander ?? me()} is incident commander.`, now)],
                }
          );
          set({ now });
        },

        setStatus(id, status, note) {
          const now = Date.now();
          const inc = get().incidents.find((i) => i.id === id);
          if (!inc || inc.status === status) return;
          if (status === "resolved") return get().resolve(id, note ?? "Resolved.");
          patchIncident(id, (i) => {
            const idx = STATUS_ORDER.indexOf(status);
            const next: Incident = { ...i, status };
            if (idx >= 1 && !next.acknowledgedAt) {
              next.acknowledgedAt = now;
              next.commander = next.commander ?? me();
            }
            if (status === "monitoring") next.mitigatedAt = next.mitigatedAt ?? now;
            if (idx < STATUS_ORDER.indexOf("monitoring")) next.mitigatedAt = undefined;
            if (i.status === "resolved") {
              next.resolvedAt = undefined;
              next.resolutionNote = undefined;
            }
            const events = [ev("status", me(), i.status === "resolved" ? `Reopened. Status changed to ${STATUS_LABEL[status]}.` : `Status changed to ${STATUS_LABEL[status]}.`, now)];
            if (note?.trim()) events.push(ev("note", me(), note.trim(), now + 1));
            next.timeline = [...i.timeline, ...events];
            return next;
          });
          set((s) => ({
            now,
            notifications:
              status === "monitoring"
                ? [notif({ title: `${id} is now monitoring`, body: "Mitigation applied. Watching for recovery.", severity: "info", incidentId: id }), ...s.notifications].slice(0, 60)
                : s.notifications,
          }));
        },

        resolve(id, note) {
          const now = Date.now();
          const inc = get().incidents.find((i) => i.id === id);
          if (!inc) return;
          patchIncident(id, (i) => ({
            ...i,
            status: "resolved",
            resolvedAt: now,
            mitigatedAt: i.mitigatedAt ?? now,
            acknowledgedAt: i.acknowledgedAt ?? now,
            commander: i.commander ?? me(),
            resolutionNote: note.trim() || "Resolved.",
            timeline: [...i.timeline, ev("resolved", me(), note.trim() || "Resolved.", now)],
          }));
          set((s) => ({
            now,
            notifications: [notif({ title: `${id} resolved`, body: inc.title, severity: "info", incidentId: id }), ...s.notifications].slice(0, 60),
          }));
        },

        setSeverity(id, sev) {
          patchIncident(id, (i) =>
            i.severity === sev ? i : { ...i, severity: sev, timeline: [...i.timeline, ev("severity", me(), `Severity changed from ${i.severity} to ${sev}.`)] }
          );
        },

        addNote(id, text, type = "note") {
          if (!text.trim()) return;
          patchIncident(id, (i) => ({ ...i, timeline: [...i.timeline, ev(type, me(), text.trim())] }));
        },

        saveAnalysis(a) {
          set((s) => ({ analyses: { ...s.analyses, [a.incidentId]: { ...a, completedActions: s.analyses[a.incidentId]?.completedActions ?? [] } } }));
          patchIncident(a.incidentId, (i) => ({
            ...i,
            timeline: [
              ...i.timeline,
              ev("analysis", "Sentinel", `Root cause analysis completed (${a.mode === "ai" ? `Claude · ${a.model}` : "demo intelligence"}): ${a.rootCause.title} (${a.confidence}% confidence).`),
            ],
          }));
        },

        toggleActionDone(incidentId, action) {
          const a = get().analyses[incidentId];
          if (!a) return;
          const done = new Set(a.completedActions ?? []);
          const completing = !done.has(action);
          if (completing) done.add(action);
          else done.delete(action);
          set((s) => ({ analyses: { ...s.analyses, [incidentId]: { ...a, completedActions: [...done] } } }));
          if (completing) get().addNote(incidentId, `Completed recommended action: ${action}`, "action");
        },

        markRead(id) {
          set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
        },
        markAllRead() {
          set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
        },
        clearNotifications() {
          set({ notifications: [] });
        },

        updateSettings(patch) {
          set((s) => ({ settings: { ...s.settings, ...patch } }));
        },

        resetDemo() {
          const now = Date.now();
          const seed = buildSeed(now);
          set((s) => ({ ...seed, analyses: {}, seededAt: now, now, live: true, settings: { ...s.settings, chaosMode: false } }));
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => zustandStorage),
      skipHydration: true,
      partialize: (s): PersistedState => ({
        incidents: s.incidents,
        changes: s.changes,
        notifications: s.notifications.slice(0, 60),
        analyses: s.analyses,
        settings: s.settings,
        seededAt: s.seededAt,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedState>;
        return { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } };
      },
    }
  )
);

export const activeIncidents = (incidents: Incident[]) => incidents.filter((i) => i.status !== "resolved");
