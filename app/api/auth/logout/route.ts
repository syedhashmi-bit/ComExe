import { NextResponse } from "next/server";
import { destroySession, getSessionFromCookie, SESSION_COOKIE } from "@/app/lib/auth";

export async function POST(req: Request) {
  const token = getSessionFromCookie(req.headers.get("cookie"));
  if (token) destroySession(token);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
