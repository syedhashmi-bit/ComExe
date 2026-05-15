import { NextResponse } from "next/server";
import { isAuthEnabled, isProxyMode, validateSession, getSessionFromCookie } from "@/app/lib/auth";

export async function GET(req: Request) {
  const enabled = isAuthEnabled();
  const proxy = isProxyMode();

  if (!enabled) {
    return NextResponse.json({ enabled: false, authenticated: true });
  }

  if (proxy) {
    const header = (process.env.AUTH_PROXY_HEADER ?? "").trim();
    const user = req.headers.get(header) ?? null;
    return NextResponse.json({ enabled: true, proxy: true, authenticated: !!user, user });
  }

  const token = getSessionFromCookie(req.headers.get("cookie"));
  const authenticated = !!token && validateSession(token);
  return NextResponse.json({ enabled: true, proxy: false, authenticated });
}
