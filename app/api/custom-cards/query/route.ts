import { NextResponse } from "next/server";
import { loadConfig } from "@/app/lib/server-config";

// ── GET /api/custom-cards/query?q=<PromQL> ──────────────────────────────────
// Executes a single PromQL instant query and returns the numeric result.
// Used by custom card rendering on the client to fetch live values.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "Missing ?q= param" }, { status: 400 });

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
    return NextResponse.json({ value, raw: json.data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
