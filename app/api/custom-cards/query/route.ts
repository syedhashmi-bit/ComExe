import { NextResponse } from "next/server";
import { loadConfig } from "@/app/lib/server-config";
import "@/app/lib/fetch-agent";

// ── GET /api/custom-cards/query?q=<PromQL> ──────────────────────────────────
// Executes a single PromQL instant query and returns the numeric result.
// Used by custom card rendering on the client to fetch live values.

// 9s in-memory cache per query string — matches the metrics-route TTL.
// CustomCardsGrid polls every `settings.refreshInterval` (default 10s); with
// N user-defined cards that's N×6/min PromQL hits. Caching dedupes when the
// same query is shared across cards / multiple browser tabs.
const cache = new Map<string, { value: unknown; ts: number }>();
const CACHE_TTL = 9_000;

function pruneCache() {
  const cutoff = Date.now() - CACHE_TTL * 2;
  for (const [k, v] of cache) if (v.ts < cutoff) cache.delete(k);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "Missing ?q= param" }, { status: 400 });

  const hit = cache.get(q);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return NextResponse.json(hit.value);
  }

  const cfg = await loadConfig();
  const promUrl = `${cfg.prometheusUrl}/api/v1/query?query=${encodeURIComponent(q)}`;

  try {
    const res = await fetch(promUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return NextResponse.json({ error: `Prometheus returned ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    const result = json?.data?.result?.[0]?.value?.[1];
    const value = result != null ? parseFloat(result) : null;
    const payload = { value, raw: json.data };
    cache.set(q, { value: payload, ts: Date.now() });
    if (cache.size > 50) pruneCache();
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
