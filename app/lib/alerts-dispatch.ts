// ── Alert state, evaluation and webhook dispatch ────────────────────────────
// Server-side owner of data/alerts.json. Used by /api/alerts (GET config and
// recent fires, PATCH config) and by the background collector, which is the
// only thing that evaluates alerts.
//
// Evaluation used to happen only when a browser tab POSTed its latest metrics
// to /api/alerts. With no tab open — or with the tab hidden, since polling
// pauses then — nothing was evaluated, so webhooks never fired overnight.
//
// IMPORTANT: server-only. Never import from "use client" modules.

import os from "node:os";
import { fetchWithTimeout } from "@/app/lib/http";
import { createJsonStore } from "@/app/lib/json-store";
import { globalSingleton } from "@/app/lib/singleton";
import {
  evaluateAlerts, inQuietHours, buildWebhookPayload,
  type AlertFire, type WebhookFormat,
} from "@/app/lib/alert-events";
import type { Metrics, ServiceResult } from "@/app/lib/types";

export const MAX_HISTORY = 50;

export interface AlertConfig {
  enabled:              boolean;
  webhookUrl:           string;
  webhookFormat:        WebhookFormat;
  throttleMs:           number;
  browserNotifications: boolean;
  quietHoursEnabled:    boolean;
  quietHoursStart:      number; // 0–23
  quietHoursEnd:        number; // 0–23
}

export interface AlertState {
  config:   AlertConfig;
  lastFire: Record<string, number>;
  recent:   AlertFire[];           // most-recent first, capped to MAX_HISTORY
}

export const DEFAULT_CONFIG: AlertConfig = {
  enabled:              false,
  webhookUrl:           "",
  webhookFormat:        "generic",
  throttleMs:           5 * 60 * 1000,
  browserNotifications: true,
  quietHoursEnabled:    false,
  quietHoursStart:      22,
  quietHoursEnd:         7,
};

const store = createJsonStore<Partial<AlertState>>("alerts.json", () => ({}));

const shared = globalSingleton("alerts", () => ({
  // Every read-modify-write of alerts.json runs through this chain. The
  // collector's evaluation and a Settings-panel PATCH can otherwise interleave
  // and one silently discards the other's changes.
  queue: Promise.resolve() as Promise<unknown>,
}));

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = shared.queue.then(fn, fn);
  shared.queue = run.catch(() => {});
  return run;
}

export async function loadAlertState(): Promise<AlertState> {
  const parsed = await store.read();
  return {
    config:   { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
    lastFire: parsed.lastFire ?? {},
    recent:   Array.isArray(parsed.recent) ? parsed.recent.slice(0, MAX_HISTORY) : [],
  };
}

// Resolves once every queued alerts.json write has finished. Used on shutdown.
export function alertWritesSettled(): Promise<void> {
  return shared.queue.then(() => {});
}

export function updateAlertConfig(
  incoming: Partial<AlertConfig>,
): Promise<{ ok: true; config: AlertConfig } | { ok: false; message: string }> {
  return serialized(async () => {
    const state = await loadAlertState();
    const next: AlertState = { ...state, config: { ...state.config, ...incoming } };
    const res = await store.tryWrite(next);
    return res.ok ? { ok: true as const, config: next.config } : { ok: false as const, message: res.message ?? "write failed" };
  });
}

async function dispatchWebhook(url: string, format: WebhookFormat, fires: AlertFire[]): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const payload = buildWebhookPayload(format, fires, os.hostname());
    const res = await fetchWithTimeout(url, {
      method:    "POST",
      timeoutMs: 5_000,
      headers:   { "Content-Type": "application/json" },
      body:      JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface DispatchResult {
  fires:          AlertFire[];
  quiet:          boolean;
  webhookResult?: { ok: boolean; status?: number; error?: string };
}

// Evaluates thresholds against the latest data. When alerts are enabled,
// persists new lastFire/recent and dispatches the webhook (skipped during quiet
// hours — the fire is still recorded so it shows in history).
export function evaluateAndDispatch(input: {
  metrics:  Metrics | null | undefined;
  services: ServiceResult[] | null | undefined;
  now?:     number;
}): Promise<DispatchResult> {
  return serialized(async () => {
    const state = await loadAlertState();
    if (!state.config.enabled) return { fires: [], quiet: false };

    const now = input.now ?? Date.now();
    const { fires, newLastFire } = evaluateAlerts({
      metrics:    input.metrics,
      services:   input.services,
      lastFire:   state.lastFire,
      throttleMs: state.config.throttleMs,
      now,
    });
    if (fires.length === 0) return { fires, quiet: false };

    const quiet = state.config.quietHoursEnabled
      && inQuietHours(new Date(now), state.config.quietHoursStart, state.config.quietHoursEnd);

    let webhookResult: DispatchResult["webhookResult"];
    if (!quiet && state.config.webhookUrl) {
      webhookResult = await dispatchWebhook(state.config.webhookUrl, state.config.webhookFormat, fires);
    }

    const recent = [...fires, ...state.recent].slice(0, MAX_HISTORY);
    await store.tryWrite({ ...state, lastFire: newLastFire, recent });
    return { fires, quiet, webhookResult };
  });
}
