import { NextResponse } from "next/server";
import { isHttpUrl, isJsonContentType } from "@/app/lib/validate";
import { loadAlertState, updateAlertConfig, type AlertConfig } from "@/app/lib/alerts-dispatch";
import type { WebhookFormat } from "@/app/lib/alert-events";

// ── /api/alerts ──────────────────────────────────────────────────────────────
// GET   → { config, recent } — read user prefs + last 20 fires
// PATCH → partial config update. Body is a subset of AlertConfig.
//
// There is deliberately no POST. Evaluation used to be driven by the browser
// POSTing { metrics, services } here, which meant alerts only fired while a tab
// was open and visible, and let any LAN client submit made-up metrics to
// trigger the user's webhook. The background collector (lib/collector.ts) now
// evaluates server-side via lib/alerts-dispatch.ts and pushes fires to open
// tabs over SSE.

export async function GET() {
  const state = await loadAlertState();
  return NextResponse.json({
    config: state.config,
    recent: state.recent.slice(0, 20),
  });
}

// ── PATCH ────────────────────────────────────────────────────────────────────
// Partial config update from the Settings panel.

export async function PATCH(req: Request) {
  if (!isJsonContentType(req)) {
    return NextResponse.json({ ok: false, message: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: Partial<AlertConfig>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 }); }

  // Whitelist + shape-check
  const incoming: Partial<AlertConfig> = {};
  if (typeof body.enabled              === "boolean") incoming.enabled = body.enabled;
  // Every other field here is range- or enum-checked; this one was `typeof ===
  // "string"` only, and it is the one field we later POST alert payloads to
  // (including os.hostname()). "" is allowed so the user can clear it.
  if (body.webhookUrl === "" || isHttpUrl(body.webhookUrl)) incoming.webhookUrl = body.webhookUrl as string;
  if (typeof body.webhookFormat        === "string" && ["generic","discord","slack","ntfy"].includes(body.webhookFormat)) incoming.webhookFormat = body.webhookFormat as WebhookFormat;
  if (typeof body.throttleMs           === "number" && body.throttleMs >= 1000) incoming.throttleMs = body.throttleMs;
  if (typeof body.browserNotifications === "boolean") incoming.browserNotifications = body.browserNotifications;
  if (typeof body.quietHoursEnabled    === "boolean") incoming.quietHoursEnabled = body.quietHoursEnabled;
  if (typeof body.quietHoursStart      === "number" && body.quietHoursStart >= 0 && body.quietHoursStart <= 23) incoming.quietHoursStart = Math.floor(body.quietHoursStart);
  if (typeof body.quietHoursEnd        === "number" && body.quietHoursEnd   >= 0 && body.quietHoursEnd   <= 23) incoming.quietHoursEnd   = Math.floor(body.quietHoursEnd);

  const result = await updateAlertConfig(incoming);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: "Could not write data/alerts.json — is /app/data writable?" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, config: result.config });
}
