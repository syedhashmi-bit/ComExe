import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fetchWithTimeout } from "@/app/lib/http";
import {
  evaluateAlerts, inQuietHours, buildWebhookPayload,
  type AlertFire, type WebhookFormat,
} from "@/app/lib/alert-events";
import type { Metrics, ServiceResult } from "@/app/lib/types";

// ── /api/alerts ──────────────────────────────────────────────────────────────
// GET  → { config, recent } — read user prefs + last 50 fires
// POST → { metrics, services } → evaluates fires, dispatches webhook, persists
//         state. Returns { fires } so the browser can fire Notifications API.
// PATCH → partial config update. Body is a subset of AlertConfig.

const DATA_DIR  = path.join(process.cwd(), "data");
const ALERTS_PATH = path.join(DATA_DIR, "alerts.json");
const MAX_HISTORY = 50;

interface AlertConfig {
  enabled:              boolean;
  webhookUrl:           string;
  webhookFormat:        WebhookFormat;
  throttleMs:           number;
  browserNotifications: boolean;
  quietHoursEnabled:    boolean;
  quietHoursStart:      number; // 0–23
  quietHoursEnd:        number; // 0–23
}

interface AlertState {
  config:   AlertConfig;
  lastFire: Record<string, number>;
  recent:   AlertFire[];           // most-recent first, capped to MAX_HISTORY
}

const DEFAULT_CONFIG: AlertConfig = {
  enabled:              false,
  webhookUrl:           "",
  webhookFormat:        "generic",
  throttleMs:           5 * 60 * 1000,
  browserNotifications: true,
  quietHoursEnabled:    false,
  quietHoursStart:      22,
  quietHoursEnd:         7,
};

let cache: { state: AlertState; ts: number } | null = null;
const CACHE_TTL = 5_000;

async function loadState(): Promise<AlertState> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.state;
  try {
    const raw = await fs.readFile(ALERTS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AlertState>;
    const state: AlertState = {
      config:   { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
      lastFire: parsed.lastFire ?? {},
      recent:   Array.isArray(parsed.recent) ? parsed.recent.slice(0, MAX_HISTORY) : [],
    };
    cache = { state, ts: Date.now() };
    return state;
  } catch {
    const state: AlertState = { config: DEFAULT_CONFIG, lastFire: {}, recent: [] };
    cache = { state, ts: Date.now() };
    return state;
  }
}

async function saveState(state: AlertState): Promise<boolean> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = ALERTS_PATH + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, ALERTS_PATH);
    cache = { state, ts: Date.now() };
    return true;
  } catch {
    return false;
  }
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

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const state = await loadState();
  return NextResponse.json({
    config: state.config,
    recent: state.recent.slice(0, 20),
  });
}

// ── POST ─────────────────────────────────────────────────────────────────────
// Body: { metrics?, services? }
// Evaluates fires given current state. If alerts.enabled === true, persists
// new lastFire/recent and dispatches webhook (skipping during quiet hours).
// Returns { fires } so the browser can decide whether to push notifications.

export async function POST(req: Request) {
  let body: { metrics?: Metrics | null; services?: ServiceResult[] | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 }); }

  const state = await loadState();
  if (!state.config.enabled) {
    return NextResponse.json({ ok: true, fires: [], enabled: false });
  }

  const now = Date.now();
  const { fires, newLastFire } = evaluateAlerts({
    metrics:    body.metrics,
    services:   body.services,
    lastFire:   state.lastFire,
    throttleMs: state.config.throttleMs,
    now,
  });

  if (fires.length === 0) {
    return NextResponse.json({ ok: true, fires: [], enabled: true });
  }

  // Suppress webhook dispatch during quiet hours; we still record the fire so
  // the browser pill counter is accurate and the user sees it in history.
  const quiet = state.config.quietHoursEnabled
    && inQuietHours(new Date(now), state.config.quietHoursStart, state.config.quietHoursEnd);

  let webhookResult: { ok: boolean; status?: number; error?: string } | undefined;
  if (!quiet && state.config.webhookUrl) {
    webhookResult = await dispatchWebhook(state.config.webhookUrl, state.config.webhookFormat, fires);
  }

  const newRecent = [...fires, ...state.recent].slice(0, MAX_HISTORY);
  await saveState({ ...state, lastFire: newLastFire, recent: newRecent });

  return NextResponse.json({ ok: true, fires, enabled: true, quiet, webhookResult });
}

// ── PATCH ────────────────────────────────────────────────────────────────────
// Partial config update from the Settings panel.

export async function PATCH(req: Request) {
  let body: Partial<AlertConfig>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 }); }

  // Whitelist + shape-check
  const incoming: Partial<AlertConfig> = {};
  if (typeof body.enabled              === "boolean") incoming.enabled = body.enabled;
  if (typeof body.webhookUrl           === "string")  incoming.webhookUrl = body.webhookUrl;
  if (typeof body.webhookFormat        === "string" && ["generic","discord","slack","ntfy"].includes(body.webhookFormat)) incoming.webhookFormat = body.webhookFormat as WebhookFormat;
  if (typeof body.throttleMs           === "number" && body.throttleMs >= 1000) incoming.throttleMs = body.throttleMs;
  if (typeof body.browserNotifications === "boolean") incoming.browserNotifications = body.browserNotifications;
  if (typeof body.quietHoursEnabled    === "boolean") incoming.quietHoursEnabled = body.quietHoursEnabled;
  if (typeof body.quietHoursStart      === "number" && body.quietHoursStart >= 0 && body.quietHoursStart <= 23) incoming.quietHoursStart = Math.floor(body.quietHoursStart);
  if (typeof body.quietHoursEnd        === "number" && body.quietHoursEnd   >= 0 && body.quietHoursEnd   <= 23) incoming.quietHoursEnd   = Math.floor(body.quietHoursEnd);

  const state = await loadState();
  const newState: AlertState = { ...state, config: { ...state.config, ...incoming } };
  const ok = await saveState(newState);
  if (!ok) {
    return NextResponse.json({ ok: false, message: "Could not write data/alerts.json — is /app/data writable?" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, config: newState.config });
}
