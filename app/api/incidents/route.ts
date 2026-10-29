import { NextResponse } from "next/server";
import { getIncidentLog } from "@/app/lib/incidents";
import { isCollectorEnabled } from "@/app/lib/collector";

// The incident log the background collector keeps (lib/incidents.ts): what
// went wrong, when, and for how long. Read-only — the collector is the only
// writer. `hours` (1–168, default 24) bounds the incidents returned; `last` is
// the most recent finished incident within the log's 7-day retention, which is
// what the status line's "last incident" uses.
export async function GET(req: Request) {
  if (!isCollectorEnabled()) return NextResponse.json({ enabled: false });

  const raw = Number(new URL(req.url).searchParams.get("hours") ?? 24);
  const hours = Number.isFinite(raw) ? Math.min(168, Math.max(1, raw)) : 24;
  const now = Date.now();
  const from = now - hours * 3_600_000;

  const log = await getIncidentLog();
  return NextResponse.json({
    enabled:   true,
    since:     log.since,
    now,
    incidents: log.incidents.filter((i) => i.end == null || i.end >= from),
    last:      log.incidents.find((i) => i.end != null) ?? null,
  });
}
