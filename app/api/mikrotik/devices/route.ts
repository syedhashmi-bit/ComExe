import { NextResponse } from "next/server";
import { loadConfig } from "@/app/lib/server-config";

// ── /api/mikrotik/devices ────────────────────────────────────────────────────
// Lists DHCP leases from the MikroTik router so the user sees what's actually
// on their network. Each lease becomes one row in the dashboard's Devices
// section (under MikrotikTab). The `online` flag is derived from `last-seen`:
// anything seen in the last 5 min counts as online.

export interface DeviceRow {
  mac:         string;
  ip:          string;
  hostname:    string | null;
  comment:     string | null;
  online:      boolean;
  lastSeenSec: number | null;   // seconds since last seen, null if never
  dynamic:     boolean;
}

let cache: { data: DeviceRow[]; ts: number } | null = null;
const CACHE_TTL = 15_000;
const ONLINE_WINDOW_SEC = 300;

// MikroTik returns last-seen like "1m37s", "12h4m", "2w1d3h". Parse to seconds.
function parseLastSeen(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let total = 0;
  for (const m of v.matchAll(/(\d+)([wdhms])/g)) {
    const n = parseInt(m[1], 10);
    switch (m[2]) {
      case "w": total += n * 7 * 86400; break;
      case "d": total += n * 86400;     break;
      case "h": total += n * 3600;      break;
      case "m": total += n * 60;        break;
      case "s": total += n;             break;
    }
  }
  return total || null;
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json({ devices: cache.data });
  }

  const cfg = await loadConfig();
  if (!cfg.mikrotik.configured) {
    return NextResponse.json({ error: "MikroTik credentials not set", envVar: cfg.mikrotik.envVar ?? [] }, { status: 503 });
  }

  try {
    const auth = Buffer.from(`${cfg.mikrotik.username}:${cfg.mikrotik.password}`, "utf8").toString("base64");
    const res = await fetch(`${cfg.mikrotik.url}/rest/ip/dhcp-server/lease`, {
      headers: { Authorization: "Basic " + auth, Accept: "application/json" },
      cache:   "no-store",
      signal:  AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json() as Record<string, unknown>[];

    const devices: DeviceRow[] = raw.map(lease => {
      const mac      = String(lease["mac-address"] ?? "").trim();
      const ip       = String(lease["address"]     ?? "").trim();
      const hostname = (lease["host-name"]      ? String(lease["host-name"]).trim() || null : null);
      const comment  = (lease["comment"]        ? String(lease["comment"]).trim()   || null : null);
      const dynamic  = String(lease["dynamic"] ?? "").toLowerCase() === "true";
      const lastSeenSec = parseLastSeen(lease["last-seen"]);
      const status   = String(lease["status"] ?? "").toLowerCase();
      // "bound" + recently seen = online. Some MikroTik versions don't surface
      // last-seen for currently-active leases, so fall back to status==bound
      // when lastSeen is missing.
      const online = lastSeenSec != null
        ? lastSeenSec < ONLINE_WINDOW_SEC
        : status === "bound";
      return { mac, ip, hostname, comment, online, lastSeenSec, dynamic };
    }).filter(d => d.mac);   // drop entries without a MAC — useless

    // Sort: online first, then by hostname/IP for stable order
    devices.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return (a.hostname ?? a.ip).localeCompare(b.hostname ?? b.ip);
    });

    cache = { data: devices, ts: Date.now() };
    return NextResponse.json({ devices });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
