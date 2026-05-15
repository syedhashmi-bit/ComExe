import { NextResponse } from "next/server";
import { readHistory, appendHistory, downsample, rotateHistory, type HistoryPoint } from "@/app/lib/history";

// ── GET /api/history ────────────────────────────────────────────────────────
// Query params:
//   metric  — "cpu" | "mem" | "net_rx" | "net_tx" | "gpu" | "disk_pct" (optional filter)
//   range   — "1h" | "6h" | "24h" | "7d" (default 24h)
//   limit   — max points to return (default 500)
//   bucket  — downsample bucket size in seconds (auto-calculated if omitted)

const RANGE_MAP: Record<string, number> = {
  "1h":  3_600_000,
  "6h":  21_600_000,
  "24h": 86_400_000,
  "7d":  604_800_000,
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const metric  = url.searchParams.get("metric") as keyof Omit<HistoryPoint, "ts"> | null;
  const range   = url.searchParams.get("range") ?? "24h";
  const limit   = Math.min(parseInt(url.searchParams.get("limit") ?? "500", 10) || 500, 2000);

  const rangeMs = RANGE_MAP[range] ?? RANGE_MAP["24h"];
  let points = await readHistory({ metric: metric ?? undefined, rangeMs, limit: limit * 2 });

  // Auto-downsample: target ~limit points
  if (points.length > limit) {
    const bucketMs = Math.ceil(rangeMs / limit);
    points = downsample(points, bucketMs);
  }

  // If a specific metric was requested, strip the others to save bandwidth
  if (metric) {
    const slim = points.map(p => ({ ts: p.ts, [metric]: p[metric] }));
    return NextResponse.json({ points: slim, count: slim.length, range, metric });
  }

  return NextResponse.json({ points, count: points.length, range });
}

// ── POST /api/history ───────────────────────────────────────────────────────
// Called by the metrics polling loop to record a data point.
// Body: HistoryPoint (or the essential fields; ts is auto-set if missing).

export async function POST(req: Request) {
  let body: Partial<HistoryPoint>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  const point: HistoryPoint = {
    ts:       body.ts ?? Date.now(),
    cpu:      body.cpu ?? null,
    mem:      body.mem ?? null,
    net_rx:   body.net_rx ?? null,
    net_tx:   body.net_tx ?? null,
    gpu:      body.gpu ?? null,
    disk_pct: body.disk_pct ?? null,
  };

  await appendHistory(point);

  // Rotate every ~100 writes (probabilistic to avoid checking every call)
  if (Math.random() < 0.01) {
    rotateHistory().catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
