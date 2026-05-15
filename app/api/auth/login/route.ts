import { NextResponse } from "next/server";
import {
  isAuthEnabled, verifyPassword, createSession, checkRateLimit,
  SESSION_COOKIE, SESSION_MAX_AGE,
} from "@/app/lib/auth";

export async function POST(req: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ ok: true, message: "Auth not enabled" });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
           ?? req.headers.get("x-real-ip")
           ?? "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, message: "Too many attempts — try again in a minute" },
      { status: 429 },
    );
  }

  let body: { password?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 }); }

  const password = typeof body.password === "string" ? body.password : "";
  if (!verifyPassword(password)) {
    return NextResponse.json({ ok: false, message: "Wrong password" }, { status: 401 });
  }

  const token = createSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   req.url.startsWith("https"),
    sameSite: "lax",
    path:     "/",
    maxAge:   SESSION_MAX_AGE,
  });
  return res;
}
