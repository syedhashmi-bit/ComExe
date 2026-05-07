import { NextResponse } from "next/server";

const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";
const BASE  = `http://${TRUENAS_IP}:30220`;
const TOKEN = "***REMOVED***";
const AUTH  = { Authorization: `Bearer ${TOKEN}` };

type V1Result = {
  id?: number;
  ping?: number | null;
  download_bits?: number | null;
  upload_bits?: number | null;
  download_bits_human?: string | null;
  upload_bits_human?: string | null;
  created_at?: string | null;
};

type LegacyResult = {
  id?: number;
  ping?: number | null;
  download?: number | null;
  upload?: number | null;
  server_name?: string | null;
  failed?: boolean;
  created_at?: string | null;
};

function normalizeV1(r: V1Result) {
  return {
    download:  r.download_bits != null ? r.download_bits / 1_000_000 : null,
    upload:    r.upload_bits   != null ? r.upload_bits   / 1_000_000 : null,
    ping:      r.ping  ?? null,
    timestamp: r.created_at ?? null,
  };
}

function normalizeLegacy(r: LegacyResult) {
  return {
    download:  r.download  ?? null,
    upload:    r.upload    ?? null,
    ping:      r.ping      ?? null,
    timestamp: r.created_at ?? null,
  };
}

export async function GET() {
  // Primary: authenticated v1 API, sorted newest first
  try {
    const res = await fetch(`${BASE}/api/v1/results?take=20&sort=-id`, {
      headers: AUTH,
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });
    console.log("speedtest v1 status:", res.status);
    if (res.ok) {
      const json = await res.json() as { data?: V1Result[] };
      console.log("speedtest v1 data:", JSON.stringify(json).slice(0, 300));
      const rows = json.data ?? [];
      if (rows.length > 0) {
        return NextResponse.json({ results: rows.map(normalizeV1), timestamp: Date.now() });
      }
    }
  } catch (e) {
    console.error("speedtest v1 error:", e);
  }

  // Fallback: legacy latest single result
  try {
    const res = await fetch(`${BASE}/api/speedtest/latest`, {
      headers: AUTH,
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json() as { data?: LegacyResult };
      const single = json.data;
      if (single) {
        return NextResponse.json({ results: [normalizeLegacy(single)], timestamp: Date.now() });
      }
    }
  } catch { /* fall through */ }

  return NextResponse.json({ results: [], timestamp: Date.now() });
}
