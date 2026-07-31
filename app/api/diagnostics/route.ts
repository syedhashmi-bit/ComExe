import { NextResponse } from "next/server";
import { snapshot } from "@/app/lib/circuit-breaker";
import { promVector } from "@/app/lib/prometheus";
import { loadConfig } from "@/app/lib/server-config";

export const dynamic = "force-dynamic";

// ── /api/diagnostics ─────────────────────────────────────────────────────────
// Self-observability: the dashboard watches every service except itself. When
// cards go blank there was no way to tell whether an upstream was down, the
// dashboard couldn't reach it, or the deploy had broken something — the whole
// codebase swallows errors and renders "—" by design.
//
// Reports, per upstream origin: circuit state, consecutive failures, last
// success/failure and the last error string. Plus Prometheus scrape-target
// health, since "Prometheus is up but its exporters aren't" is the failure
// that empties the metric grid.

export async function GET() {
  const cfg = await loadConfig();

  let scrapeTargets: { job: string; instance: string; up: boolean }[] = [];
  let prometheusReachable = true;
  try {
    const rows = await promVector(cfg.prometheusUrl, "up");
    scrapeTargets = rows.map(r => ({
      job:      r.metric?.job ?? "unknown",
      instance: r.metric?.instance ?? "unknown",
      up:       r.value === 1,
    }));
    // promVector swallows failures and returns [] — treat "no series at all"
    // as unreachable, since a live Prometheus always scrapes at least itself.
    prometheusReachable = rows.length > 0;
  } catch {
    prometheusReachable = false;
  }

  const upstreams = snapshot();

  return NextResponse.json({
    upstreams,
    prometheus: {
      url:       cfg.prometheusUrl,
      reachable: prometheusReachable,
      targets:   scrapeTargets,
      targetsDown: scrapeTargets.filter(t => !t.up).map(t => t.job),
    },
    summary: {
      openCircuits:    upstreams.filter(u => u.state === "open").length,
      degradedUpstreams: upstreams.filter(u => u.consecutiveFailures > 0).length,
      totalUpstreams:  upstreams.length,
    },
    timestamp: Date.now(),
  });
}
