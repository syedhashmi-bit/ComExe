import { NextResponse } from "next/server";

type V1Result = {
  ping?: number | null;
  download_bits?: number | null;
  upload_bits?: number | null;
  created_at?: string | null;
};

export async function GET() {
  try {
    const res = await fetch(
      "http://192.168.88.196:30220/api/v1/results?take=20&sort=-id",
      {
        headers: {
          Authorization: "Bearer ***REMOVED***",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
        next: { revalidate: 0 },
      }
    );
    const data = await res.json() as { data?: V1Result[] };
    console.log("speedtest list status:", res.status);
    console.log("speedtest list count:", data.data?.length);

    const results = (data.data ?? []).map(r => ({
      download:  (r.download_bits ?? 0) / 1_000_000,
      upload:    (r.upload_bits   ?? 0) / 1_000_000,
      ping:      r.ping      ?? null,
      timestamp: r.created_at ?? null,
    })).reverse();

    return NextResponse.json({ results, timestamp: Date.now() });
  } catch (e) {
    console.error("speedtest error:", e);
    return NextResponse.json({ results: [], timestamp: Date.now() });
  }
}
