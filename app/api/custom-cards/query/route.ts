import { NextResponse } from "next/server";
import { loadConfig } from "@/app/lib/server-config";
import { fetchWithTimeout } from "@/app/lib/http";
import { createKeyedTTLCache } from "@/app/lib/cache";

// ── GET /api/custom-cards/query?q=<PromQL> ──────────────────────────────────
// Executes a single PromQL instant query and returns the numeric result.
// Used by custom card rendering on the client to fetch live values.

// 9s in-memory cache per query string — matches the metrics-route TTL.
// CustomCardsGrid polls every `settings.refreshInterval` (default 10s); with
// N user-defined cards that's N×6/min PromQL hits. Caching dedupes when the
// same query is shared across cards / multiple browser tabs. Capped at 50
// distinct queries (oldest evicted). Unlike the other Prometheus routes this
// can't use promScalar — it surfaces upstream failures to the client as 502
// instead of silently returning null, so it keeps its own fetch + parse.
const cache = createKeyedTTLCache<unknown>(9_000, 50);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "Missing ?q= param" }, { status: 400 });

  const hit = cache.get(q);
  if (hit) return NextResponse.json(hit);

  const cfg = await loadConfig();
  const promUrl = `${cfg.prometheusUrl}/api/v1/query?query=${encodeURIComponent(q)}`;

  try {
    const res = await fetchWithTimeout(promUrl);
    if (!res.ok) {
      return NextResponse.json({ error: `Prometheus returned ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    const result = json?.data?.result?.[0]?.value?.[1];
    const value = result != null ? parseFloat(result) : null;
    const payload = { value, raw: json.data };
    cache.set(q, payload);
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
