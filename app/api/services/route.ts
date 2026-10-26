import { NextResponse } from "next/server";
import { getServices } from "@/app/lib/services";

// Thin HTTP wrapper. The service functions, memoization, stale-while-revalidate
// and last-known-good caching all live in app/lib/services.ts, shared with the
// background collector.
export function GET() {
  return NextResponse.json(getServices());
}
