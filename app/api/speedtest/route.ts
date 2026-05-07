import { NextResponse } from "next/server";

const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";

export async function GET() {
  try {
    const res = await fetch(`http://${TRUENAS_IP}:30220/api/speedtest/latest`, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { data?: { download?: number; upload?: number; ping?: number; created_at?: string; server_name?: string } };
    const d = json.data;
    if (!d) throw new Error("no data");
    return NextResponse.json({
      results: [{
        download:  d.download  ?? null,
        upload:    d.upload    ?? null,
        ping:      d.ping      ?? null,
        timestamp: d.created_at ?? null,
        isp:       d.server_name ?? null,
      }],
      timestamp: Date.now(),
    });
  } catch (e) {
    console.error("speedtest error:", e);
    return NextResponse.json({ results: [], timestamp: Date.now() });
  }
}
