import { NextResponse } from "next/server";
import { fetchJson } from "@/app/lib/http";
import { createTTLCache } from "@/app/lib/cache";

const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";
const BASE        = process.env.SPEEDTEST_URL ?? `http://${TRUENAS_IP}:30220`;
const BEARER      = process.env.SPEEDTEST_API_KEY ?? "";

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
// SpeedTracker once per minute. Combined with the 10-minute client poll
// interval, each SpeedTracker instance sees ~6 requests/hour total.
const cache = createTTLCache<unknown>(60_000);

export async function GET() {
  const cached = cache.get();
  if (cached) return NextResponse.json(cached);

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
    `${BASE}/api/v1/results?sort=-created_at&page%5Bsize%5D=5`,
    {
      headers: BEARER ? { Authorization: `Bearer ${BEARER}`, Accept: "application/json" }
                      : { Accept: "application/json" },
    },
  );
  // Defensive: sort newest-first ourselves too, in case an older SpeedTracker
  // ignores the sort param the way it ignored `take`.
  const records: HistoryRecord[] = (json?.data ?? []).slice().sort((a, b) =>
    new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  ).slice(0, 5);
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

  const history = records
    .map(r => toMbps(r.download))
    .filter((v): v is number => v !== null)
    .reverse(); // oldest → newest for sparkline left-to-right

  const data = {
    results:    primary ? [primary] : [],
    history,
    totalTests: total,
    timestamp:  Date.now(),
  };
  cache.set(data);
  return NextResponse.json(data);
}
