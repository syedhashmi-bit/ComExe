import { NextResponse } from "next/server";
import { getMetrics } from "@/app/lib/metrics";

// Thin HTTP wrapper. The PromQL queries, transform, cache and history append
// live in app/lib/metrics.ts, shared with the background collector.
export async function GET() {
  return NextResponse.json(await getMetrics());
}
