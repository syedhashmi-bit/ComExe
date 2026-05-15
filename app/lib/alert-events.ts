// ── Alert event evaluation ───────────────────────────────────────────────────
// Pure functions: given current metrics + services + previous state, return the
// list of new "fire" events. Used by /api/alerts to decide what to dispatch.
//
// An event is identified by a stable `key` (e.g. "cpu>95", "service:radarr:down").
// Throttle is per-key: a fire is suppressed if the same key fired within
// `throttleMs` of now. The server stores `lastFire[key] = ts` between calls.

import type { Metrics, ServiceResult, AlertLevel } from "@/app/lib/types";
import {
  cpuAlertLevel, memAlertLevel, diskAlertLevel, gpuTempAlertLevel,
} from "@/app/lib/alerts";

export interface AlertFire {
  key:    string;          // dedupe key, stable across firings of same event
  ts:     number;          // when this fire was decided
  level:  "warning" | "critical";
  source: "metric" | "service";
  msg:    string;          // human-readable, used in webhook + notification body
}

export interface AlertEvaluationInput {
  metrics?:   Metrics | null;
  services?:  ServiceResult[] | null;
  lastFire:   Record<string, number>;
  throttleMs: number;
  now:        number;
}

export interface AlertEvaluationOutput {
  fires:       AlertFire[];                // new fires that should be dispatched
  newLastFire: Record<string, number>;     // updated lastFire map (merged)
}

function realMemPct(m: Metrics): number | null {
  if (m.memory.total == null || m.memory.available == null || m.memory.total === 0) return null;
  return (Math.max(0, m.memory.total - m.memory.available - (m.memory.sReclaimable ?? 0)) / m.memory.total) * 100;
}

// Pure: returns the candidate fires that *would* trigger right now, before
// throttle filtering. Exported separately so the UI can preview without
// affecting state.
export function candidateFires(metrics: Metrics | null | undefined, services: ServiceResult[] | null | undefined, now: number): AlertFire[] {
  const out: AlertFire[] = [];

  if (metrics) {
    if (metrics.cpu != null) {
      const l = cpuAlertLevel(metrics.cpu);
      if (l) out.push({ key: `cpu>${l === "critical" ? 95 : 80}`, ts: now, level: l, source: "metric", msg: `CPU at ${metrics.cpu.toFixed(0)}%` });
    }
    {
      const rp = realMemPct(metrics);
      const l = memAlertLevel(metrics.memory.total, metrics.memory.available, metrics.memory.sReclaimable);
      if (l && rp != null) out.push({ key: `mem>${l === "critical" ? 97 : 93}`, ts: now, level: l, source: "metric", msg: `Memory at ${rp.toFixed(0)}%` });
    }
    if (metrics.gpu.temperature != null) {
      const l = gpuTempAlertLevel(metrics.gpu.temperature);
      if (l) out.push({ key: `gputemp>${l === "critical" ? 90 : 80}`, ts: now, level: l, source: "metric", msg: `GPU at ${metrics.gpu.temperature.toFixed(0)}°C` });
    }
    for (const d of metrics.disks ?? []) {
      const l = diskAlertLevel(d.usedPct);
      if (l) out.push({ key: `disk:${d.mountpoint}>${l === "critical" ? 95 : 85}`, ts: now, level: l, source: "metric", msg: `Disk ${d.mountpoint} at ${d.usedPct.toFixed(0)}%` });
    }
  }

  if (services) {
    for (const s of services) {
      if (s.configured === false) continue;            // not yet set up — not an outage
      if (!s.up) {
        out.push({ key: `service:${s.name}:down`, ts: now, level: "critical", source: "service", msg: `${s.name} is unreachable` });
      } else if (s.health && s.health.error > 0) {
        out.push({ key: `service:${s.name}:error`, ts: now, level: "critical", source: "service", msg: `${s.name} reports ${s.health.error} error${s.health.error === 1 ? "" : "s"}` });
      } else if (s.health && s.health.warning > 0) {
        out.push({ key: `service:${s.name}:warn`, ts: now, level: "warning", source: "service", msg: `${s.name} reports ${s.health.warning} warning${s.health.warning === 1 ? "" : "s"}` });
      }
    }
  }

  return out;
}

export function evaluateAlerts({ metrics, services, lastFire, throttleMs, now }: AlertEvaluationInput): AlertEvaluationOutput {
  const candidates = candidateFires(metrics, services, now);
  const fires: AlertFire[] = [];
  const newLastFire: Record<string, number> = { ...lastFire };

  for (const c of candidates) {
    const prev = lastFire[c.key];
    if (prev != null && now - prev < throttleMs) continue;
    fires.push(c);
    newLastFire[c.key] = now;
  }

  return { fires, newLastFire };
}

// True when `now` is inside the [startHour, endHour) quiet-hours window,
// in local server time. Handles wraparound (22→7 spans midnight).
export function inQuietHours(now: Date, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  const h = now.getHours();
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

// Format a fire for a webhook destination. Discord, Slack, and ntfy each have
// distinct JSON shapes; "generic" is a flat shape for arbitrary endpoints.
export type WebhookFormat = "generic" | "discord" | "slack" | "ntfy";

export function buildWebhookPayload(format: WebhookFormat, fires: AlertFire[], hostname?: string): unknown {
  const host = hostname ? ` · ${hostname}` : "";
  const title = `${fires.length === 1 ? "ComExe alert" : `${fires.length} ComExe alerts`}${host}`;
  const lines = fires.map(f => `${f.level === "critical" ? "🔴" : "🟡"} ${f.msg}`);
  const body  = lines.join("\n");

  switch (format) {
    case "discord":
      return {
        username: "ComExe",
        embeds: [{
          title,
          description: body,
          color: fires.some(f => f.level === "critical") ? 0xef4444 : 0xf59e0b,
          timestamp: new Date().toISOString(),
        }],
      };
    case "slack":
      return { text: `*${title}*\n${body}` };
    case "ntfy":
      // ntfy is plain text; tags/priority go in headers, but most ntfy clients
      // also accept JSON body. Keep simple plain-text title+message.
      return { title, message: body, priority: fires.some(f => f.level === "critical") ? 5 : 3 };
    case "generic":
    default:
      return { title, body, fires };
  }
}
