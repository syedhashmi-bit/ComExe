// ── Background collector ────────────────────────────────────────────────────
// Polls metrics and services server-side whether or not a browser is open,
// appends history (via getMetrics) and evaluates alerts. Started once per
// server process from instrumentation.ts.
//
// Why it exists: alerts were evaluated only when a dashboard tab POSTed its
// latest data, and history was appended only when something requested
// /api/metrics. Close the laptop, or just hide the tab (polling pauses then),
// and webhooks stopped firing and /forecast's SLA window filled with gaps.
//
// Load: while at least one SSE client is connected, /api/stream is already
// polling metrics and services, so the collector adds zero upstream calls — it
// only evaluates alerts against whatever those polls last produced. With
// nobody connected it polls itself at IDLE_INTERVALS, lighter on the homelab
// than one open tab.
//
// IMPORTANT: server-only. Never import from "use client" modules.

import { EventEmitter } from "node:events";
import { getMetrics, peekMetrics } from "@/app/lib/metrics";
import { getServicesFresh, peekServices } from "@/app/lib/services";
import { evaluateAndDispatch, alertWritesSettled } from "@/app/lib/alerts-dispatch";
import { globalSingleton } from "@/app/lib/singleton";
import type { AlertFire } from "@/app/lib/alert-events";

// How often to evaluate alerts while SSE clients are connected (no polling).
export const ACTIVE_EVAL_MS = 10_000;
// How often to poll each source when nobody is connected.
export const IDLE_INTERVALS = { metrics: 30_000, services: 60_000 } as const;

// Events: "alert" (AlertFire[]) and "shutdown" (no payload).
interface CollectorState {
  started:     boolean;
  stopped:     boolean;
  clients:     number;
  timer:       ReturnType<typeof setTimeout> | null;
  lastMetrics: number;   // ms epoch of the last metrics poll (0 = never)
  lastServices: number;
  firstTickAt: number | null;
  lastTickAt:  number | null;
  lastError:   string | null;
  events:      EventEmitter;
}

const state = globalSingleton<CollectorState>("collector", () => {
  const events = new EventEmitter();
  // One listener per open SSE connection; don't warn at 11 tabs.
  events.setMaxListeners(0);
  return {
    started: false, stopped: false, clients: 0, timer: null,
    lastMetrics: 0, lastServices: 0,
    firstTickAt: null, lastTickAt: null, lastError: null,
    events,
  };
});

export const collectorEvents = state.events;

export function isCollectorEnabled(): boolean {
  const v = (process.env.COMEXE_COLLECTOR ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

// Called by /api/stream as connections open and close.
export function streamClientConnected(): void { state.clients++; }
export function streamClientDisconnected(): void { state.clients = Math.max(0, state.clients - 1); }

export function collectorStatus() {
  return {
    enabled:     isCollectorEnabled(),
    running:     state.started && !state.stopped,
    clients:     state.clients,
    firstTickAt: state.firstTickAt,
    lastTickAt:  state.lastTickAt,
    lastError:   state.lastError,
  };
}

// One pass: poll whatever is due (idle only), then evaluate alerts on the
// latest data. Exported for tests; the loop below is the only production caller.
export async function tick(now = Date.now()): Promise<void> {
  const active = state.clients > 0;
  const metricsDue  = now - state.lastMetrics  >= (active ? ACTIVE_EVAL_MS : IDLE_INTERVALS.metrics);
  const servicesDue = now - state.lastServices >= (active ? ACTIVE_EVAL_MS : IDLE_INTERVALS.services);
  if (!metricsDue && !servicesDue) return;

  try {
    // Only an idle, due source may cause upstream work. Everything else is a
    // peek at the last result — metrics' 9s cache is shorter than either idle
    // cadence, so a get() on the not-due side would quietly refetch.
    const [metrics, services] = await Promise.all([
      !active && metricsDue  ? getMetrics().catch(() => peekMetrics())         : Promise.resolve(peekMetrics()),
      !active && servicesDue ? getServicesFresh().catch(() => peekServices()) : Promise.resolve(peekServices()),
    ]);
    if (metricsDue)  state.lastMetrics  = now;
    if (servicesDue) state.lastServices = now;

    const { fires } = await evaluateAndDispatch({
      metrics,
      services: services?.services ?? null,
    });
    if (fires.length > 0) state.events.emit("alert", fires satisfies AlertFire[]);
    state.lastError = null;
  } catch (e) {
    state.lastError = (e as Error)?.message ?? String(e);
  } finally {
    state.lastTickAt = Date.now();
    state.firstTickAt ??= state.lastTickAt;
  }
}

// The loop re-checks every few seconds rather than sleeping a whole interval,
// so a tab connecting to an idle server moves to the active cadence promptly.
const LOOP_MS = 5_000;

function schedule(): void {
  if (state.stopped) return;
  state.timer = setTimeout(async () => {
    await tick();
    schedule();
  }, LOOP_MS);
  // Never keep the process alive just for the collector.
  state.timer.unref?.();
}

export function startCollector(): void {
  if (state.started || !isCollectorEnabled()) return;
  state.started = true;
  // First tick shortly after boot: warms the caches (the job the services
  // module-load setTimeout used to do) without competing with Next's startup.
  state.timer = setTimeout(async () => {
    await tick();
    schedule();
  }, 1_000);
  state.timer.unref?.();

  const shutdown = () => { void stopCollector(); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

// Stops the loop, tells open SSE streams to close so Next's in-flight drain
// isn't held open by long-lived connections, and waits for any alerts.json
// write to land.
export async function stopCollector(): Promise<void> {
  if (state.stopped) return;
  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
  state.events.emit("shutdown");
  await alertWritesSettled();
}
