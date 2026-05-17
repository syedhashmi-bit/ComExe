import { NextResponse } from "next/server";

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
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  // SpeedTracker is fragile under polling load — earlier versions of this
  // route also hit the legacy /api/speedtest/latest endpoint without auth,
  // which appeared to be triggering the speedtest container into a crash
  // loop. That endpoint is redundant: /api/v1/results?take=5 already returns
  // the latest test as data[0]. Single bearer-authed call now.

  let records: HistoryRecord[] = [];
  let total: number | null = null;
  try {
    const res = await fetch(`${BASE}/api/v1/results?take=5`, {
      headers: BEARER ? { Authorization: `Bearer ${BEARER}`, Accept: "application/json" }
                      : { Accept: "application/json" },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json() as { data?: HistoryRecord[]; meta?: { total?: number } };
      records = json.data ?? [];
      total   = json.meta?.total ?? null;
    }
  } catch { /* upstream down — return empty */ }

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
  cache = { data, ts: Date.now() };
  return NextResponse.json(data);
}
