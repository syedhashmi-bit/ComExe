import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/app/lib/auth";

export async function POST() {
  // Cookie-clear only. There is no server-side revocation list — see the long
  // note in lib/session-token.ts for why the previous one never worked. To
  // invalidate outstanding tokens, change DASHBOARD_PASSWORD.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
