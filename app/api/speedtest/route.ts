import { NextResponse } from "next/server";
import { fetchJson } from "@/app/lib/http";
import { createTTLCache } from "@/app/lib/cache";
import { loadConfig } from "@/app/lib/server-config";
import type { SpeedtestPoint } from "@/app/lib/types";

// URL + bearer come from loadConfig() per request, NOT process.env. Reading
// process.env at module scope meant anything saved through the /setup wizard
// (which writes data/config.json) was invisible here: the wizard's Test button
// hits /api/test-connection and reported "Connected", while this route kept
// sending no Authorization header and the card stayed empty forever.

interface HistoryRecord {
  id?:         number;
  download?:   number | null;
  upload?:     number | null;
  ping?:       number | null;
  jitter?:     number | null;
  created_at?: string | null;
  server?: {
    name?:     string | null;
    location?: string | null;
    host?:     string | null;
  } | null;
}

// 60s in-memory cache so even very-overlapping SSE clients only hit
// SpeedTracker once per minute. One call returns the last 20 results — the
// newest is the card's headline, all 20 feed its history chart. Combined with the 10-minute client poll
// interval, each SpeedTracker instance sees ~6 requests/hour total.
const cache = createTTLCache<unknown>(60_000);

export async function GET() {
  const cached = cache.get();
  if (cached) return NextResponse.json(cached);

  const cfg = await loadConfig();
  const BASE   = cfg.services.speedtest.url;
  const BEARER = cfg.services.speedtest.apiKey ?? "";

  // SpeedTracker is fragile under polling load — earlier versions of this
  // route also hit the legacy /api/speedtest/latest endpoint without auth,
  // which appeared to be triggering the speedtest container into a crash
  // loop. Single bearer-authed call now.
  //
  // Param gotchas (verified against speedtest-tracker's ResultsController):
  //   - Results have NO default sort → they come back oldest-first, so without
  //     `sort=-created_at` data[0] is the first test ever recorded (this was
  //     the "auto-tested 323d ago" bug).
  //   - Pagination is spatie json-api style `page[size]` — the previously-used
  //     `?take=5` was silently ignored.
  const json = await fetchJson<{ data?: HistoryRecord[]; meta?: { total?: number } }>(
    `${BASE}/api/v1/results?sort=-created_at&page%5Bsize%5D=20`,
    {
      headers: BEARER ? { Authorization: `Bearer ${BEARER}`, Accept: "application/json" }
                      : { Accept: "application/json" },
    },
  );
  // Defensive: sort newest-first ourselves too, in case an older SpeedTracker
  // ignores the sort param the way it ignored `take`.
  const records: HistoryRecord[] = (json?.data ?? []).slice().sort((a, b) =>
    new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  ).slice(0, 20);
  const total: number | null = json?.meta?.total ?? null;

  // linuxserver/speedtest-tracker v1 API returns download/upload in BYTES/SEC.
  // The dashboard UI labels these as Mbps and expects Mbps values (the older
  // gistia /api/speedtest/latest endpoint we used to also call returned Mbps
  // directly). Convert here so the client contract stays "always Mbps".
  // bytes/sec × 8 / 1,000,000 = Mbps.
  const toMbps = (bps: number | null | undefined): number | null =>
    bps == null ? null : Math.round((bps * 8) / 10_000) / 100; // 2dp precision

  const latest = records[0] ?? null;
  const primary = latest ? {
    download:       toMbps(latest.download),
    upload:         toMbps(latest.upload),
    ping:           latest.ping       ?? null,
    jitter:         latest.jitter     ?? null,
    timestamp:      latest.created_at ?? null,
    isp:            latest.server?.name     ?? null,
    serverLocation: latest.server?.location ?? null,
    serverHost:     latest.server?.host     ?? null,
  } : null;

  // Oldest → newest, for the chart's left-to-right.
  const tests: SpeedtestPoint[] = records
    .flatMap(r => {
      const ts = r.created_at ? Date.parse(r.created_at) : NaN;
      const download = toMbps(r.download);
      if (isNaN(ts) || download == null) return [];
      return [{ ts, download, upload: toMbps(r.upload), ping: r.ping ?? null }];
    })
    .reverse();

  const data = {
    results:    primary ? [primary] : [],
    tests,
    totalTests: total,
    timestamp:  Date.now(),
  };
  cache.set(data);
  return NextResponse.json(data);
}
