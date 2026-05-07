import { NextResponse } from "next/server";

const URL_BASE = "http://192.168.88.196:30220/api/v1/results";
const HEADERS = {
  Authorization: "Bearer ***REMOVED***",
  Accept: "application/json",
};
const OPTS = { headers: HEADERS, signal: AbortSignal.timeout(10000), next: { revalidate: 0 } } as const;

type V1Result = {
  ping?: number | null;
  download_bits?: number | null;
  upload_bits?: number | null;
  created_at?: string | null;
};

export async function GET() {
  try {
    // Step 1 — discover last page
    const metaRes  = await fetch(`${URL_BASE}?take=20`, OPTS);
    const metaData = await metaRes.json() as { meta?: { last_page?: number } };
    const lastPage = metaData.meta?.last_page ?? 1;

    // Step 2 — fetch last page (newest results)
    const res  = await fetch(`${URL_BASE}?take=20&page[number]=${lastPage}`, OPTS);
    const data = await res.json() as { data?: V1Result[] };
    console.log("speedtest last page status:", res.status);
    console.log("speedtest results count:", data.data?.length);

    const results = (data.data ?? []).map(r => ({
      download:  Math.round((r.download_bits ?? 0) / 1_000_000),
      upload:    Math.round((r.upload_bits   ?? 0) / 1_000_000),
      ping:      r.ping      ?? null,
      timestamp: r.created_at ?? null,
    }));

    return NextResponse.json({ results, timestamp: Date.now() });
  } catch (e) {
    console.error("speedtest error:", e);
    return NextResponse.json({ results: [], timestamp: Date.now() });
  }
}
