// ── Incident log ────────────────────────────────────────────────────────────
// Remembers when things went wrong and for how long, so the status line can
// say "last incident 10 h ago: Radarr unreachable for 12 min" and draw the last
// 24 hours. Alerts (lib/alerts-dispatch.ts) only record the moment a webhook
// fired, and only when webhooks are enabled; this records every problem the
// collector sees, start to end, whether or not anyone is notified.
//
// The collector calls recordIncidents() on every tick (no upstream work of its
// own). The file is written only when an incident opens, closes or worsens.
//
// IMPORTANT: server-only. Never import from "use client" modules.

import { createJsonStore } from "@/app/lib/json-store";
import { globalSingleton } from "@/app/lib/singleton";
import { candidateFires, type AlertFire } from "@/app/lib/alert-events";
import { SVC_LABELS } from "@/app/lib/constants";
import type { Incident, Metrics, ServiceResult } from "@/app/lib/types";

export const RETAIN_MS = 7 * 86_400_000;
const MAX_INCIDENTS = 500;
// A problem that clears and comes back within this window is one incident,
// not two — a flapping container shouldn't fill the log.
export const MERGE_MS = 2 * 60_000;

export interface IncidentLog {
  since:     number;       // when this log started recording
  incidents: Incident[];   // newest start first
}

// One incident per subject, whatever threshold it crossed: CPU going from 85%
// to 96% and back is one "High CPU" incident that peaked at critical, not two.
// A service being down and reporting a health error are different problems.
export function incidentKey(fireKey: string): string {
  return fireKey.replace(/>\d+$/, "").replace(/:(error|warn)$/, ":health");
}

export function incidentTitle(fire: AlertFire): string {
  const k = incidentKey(fire.key);
  const svc = k.match(/^service:(.+):(down|health)$/);
  if (svc) return `${SVC_LABELS[svc[1]] ?? svc[1]} ${svc[2] === "down" ? "unreachable" : "health check failing"}`;
  if (k === "cpu") return "High CPU";
  if (k === "mem") return "High memory";
  if (k === "gputemp") return "GPU running hot";
  if (k.startsWith("disk:")) return `${k.slice(5)} filling up`;
  return fire.msg;
}

const isServiceKey = (k: string) => k.startsWith("service:");

// Pure: apply one tick's active problems to the log. A source with no data
// this tick (metrics or services null) leaves its incidents as they were —
// "no data" isn't "recovered".
export function trackIncidents(
  log: IncidentLog,
  fires: AlertFire[],
  have: { metrics: boolean; services: boolean },
  now: number,
): { log: IncidentLog; changed: boolean } {
  const active = new Map<string, { level: Incident["level"]; title: string }>();
  for (const f of fires) {
    const key = incidentKey(f.key);
    const prev = active.get(key);
    if (!prev || (f.level === "critical" && prev.level !== "critical")) {
      active.set(key, { level: f.level, title: incidentTitle(f) });
    }
  }

  let changed = false;
  const incidents = log.incidents.map((i) => ({ ...i }));
  const observed = (key: string) => (isServiceKey(key) ? have.services : have.metrics);

  for (const inc of incidents) {
    if (inc.end != null || !observed(inc.key)) continue;
    const a = active.get(inc.key);
    if (!a) { inc.end = now; changed = true; continue; }
    if (a.level === "critical" && inc.level !== "critical") { inc.level = "critical"; changed = true; }
    active.delete(inc.key);
  }

  for (const [key, a] of active) {
    const recent = incidents.find((i) => i.key === key && i.end != null && now - i.end <= MERGE_MS);
    if (recent) {
      recent.end = null;
      if (a.level === "critical") recent.level = "critical";
    } else {
      incidents.unshift({ key, level: a.level, title: a.title, start: now, end: null });
    }
    changed = true;
  }

  const kept = incidents
    .filter((i) => i.end == null || now - i.end <= RETAIN_MS)
    .sort((a, b) => b.start - a.start)
    .slice(0, MAX_INCIDENTS);
  if (kept.length !== incidents.length) changed = true;

  return { log: { since: log.since, incidents: kept }, changed };
}

const store = createJsonStore<Partial<IncidentLog>>("incidents.json", () => ({}));

const shared = globalSingleton("incidents", () => ({
  log: null as IncidentLog | null,
  loading: null as Promise<IncidentLog> | null,
  writing: Promise.resolve() as Promise<unknown>,
}));

async function loadLog(): Promise<IncidentLog> {
  if (shared.log) return shared.log;
  shared.loading ??= store.read().then((raw) => {
    const log: IncidentLog = {
      since: typeof raw.since === "number" ? raw.since : Date.now(),
      incidents: Array.isArray(raw.incidents) ? raw.incidents : [],
    };
    shared.log = log;
    return log;
  });
  return shared.loading;
}

export async function getIncidentLog(): Promise<IncidentLog> {
  return loadLog();
}

export async function recordIncidents(input: {
  metrics:  Metrics | null | undefined;
  services: ServiceResult[] | null | undefined;
  now?:     number;
}): Promise<void> {
  const now = input.now ?? Date.now();
  const log = await loadLog();
  const fires = candidateFires(input.metrics, input.services, now);
  const { log: next, changed } = trackIncidents(log, fires, { metrics: !!input.metrics, services: !!input.services }, now);
  if (!changed) return;
  shared.log = next;
  // Writes are chained so two quick changes can't land out of order.
  shared.writing = shared.writing.then(() => store.tryWrite(next)).catch(() => {});
}

// Resolves once any pending incidents.json write has finished. Used on shutdown.
export function incidentWritesSettled(): Promise<void> {
  return shared.writing.then(() => {});
}
