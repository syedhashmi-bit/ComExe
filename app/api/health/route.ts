import { NextResponse } from "next/server";

// Liveness endpoint for the container HEALTHCHECK (see Dockerfile). Intentionally
// local-only — no upstream calls — so it reflects "is the app serving?" and never
// fails because a homelab service is down.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
