import { NextResponse } from "next/server";
import { loadConfig } from "@/app/lib/server-config";
import { fetchWithTimeout } from "@/app/lib/http";
import { createTTLCache } from "@/app/lib/cache";

function formatMikrotikUptime(uptime: string): string {
  const weeks = uptime.match(/(\d+)w/)?.[1];
  const days  = uptime.match(/(\d+)d/)?.[1];
  const hours = uptime.match(/(\d+)h/)?.[1];
  const mins  = uptime.match(/(\d+)m/)?.[1];
  const parts: string[] = [];
  if (weeks) parts.push(weeks + "w");
  if (days)  parts.push(days  + "d");
  if (hours) parts.push(hours + "h");
  if (mins)  parts.push(mins  + "m");
  return parts.join(" ") || uptime;
}

// 9s — router stats don't change rapidly and the RouterOS REST API is
// noticeably slow under any contention. Match the new 10s SSE interval.
const mikrotikCache = createTTLCache<unknown>(9_000);

export async function GET() {
  const cached = mikrotikCache.get();
  if (cached) return NextResponse.json(cached);

  const cfg = await loadConfig();
  if (!cfg.mikrotik.configured) {
    return NextResponse.json({ error: "MikroTik credentials not set", envVar: cfg.mikrotik.envVar ?? [] }, { status: 503 });
  }

  try {
    const auth = Buffer.from(`${cfg.mikrotik.username}:${cfg.mikrotik.password}`, "utf8").toString("base64");
    const res = await fetchWithTimeout(`${cfg.mikrotik.url}/rest/system/resource`, {
      method: "GET",
      headers: {
        Authorization: "Basic " + auth,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = JSON.parse(text) as Record<string, unknown>;

    const str = (k: string): string | null => typeof d[k] === "string" ? d[k] as string : null;
    const num = (k: string): number | null => {
      const v = d[k];
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "") { const n = parseFloat(v); return isNaN(n) ? null : n; }
      return null;
    };

    const memTotal = num("total-memory");
    const freeMem  = num("free-memory");
    const hddTotal = num("total-hdd-space");
    const freeHdd  = num("free-hdd-space");
    const cpuLoad  = d["cpu-load"];
    const cpu      = cpuLoad != null ? parseInt(String(cpuLoad), 10) : null;

    const ramUsed  = memTotal !== null && freeMem !== null
      ? `${((memTotal - freeMem) / 1073741824).toFixed(1)} GB` : null;
    const ramTotal = memTotal !== null
      ? `${(memTotal / 1073741824).toFixed(1)} GB` : null;
    const ramPct   = memTotal && freeMem != null
      ? Math.round(((memTotal - freeMem) / memTotal) * 100) : null;

    const responseData = {
      board:    str("board-name"),
      version:  str("version"),
      cpu,
      ramUsed,
      ramTotal,
      ramPct,
      hddUsed:  hddTotal !== null && freeHdd !== null ? hddTotal - freeHdd : null,
      hddTotal,
      uptime:   str("uptime") ? formatMikrotikUptime(str("uptime")!) : null,
      temp:     num("temperature"),
    };
    mikrotikCache.set(responseData);
    return NextResponse.json(responseData);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
