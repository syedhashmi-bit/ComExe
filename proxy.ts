import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, validateSessionToken } from "@/app/lib/session-token";

// Renamed from middleware.ts for Next 16 (the `middleware` convention is
// deprecated in favour of `proxy`, which runs on the nodejs runtime).
//
// This used to check only that the session cookie EXISTED, with a comment
// claiming the routes did the real validation — they never did, so any value
// at all (`comexe_session=x`) was a full bypass. The token is now HMAC-signed,
// which is cheap to verify statelessly right here. Per Next's own guidance the
// proxy still shouldn't be the *only* boundary for anything sensitive, but for
// a single-password homelab dashboard verifying the signature at the one choke
// point every request passes through is the correct fix.

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/_next",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if auth is enabled via env vars
  const password = (process.env.DASHBOARD_PASSWORD ?? "").trim();
  const proxyHeader = (process.env.AUTH_PROXY_HEADER ?? "").trim();
  const authEnabled = password.length > 0 || proxyHeader.length > 0;

  if (!authEnabled) return NextResponse.next();
  if (isPublicPath(pathname)) return NextResponse.next();

  // Reverse-proxy mode: trust the configured header
  if (proxyHeader) {
    const user = request.headers.get(proxyHeader);
    if (user && user.trim().length > 0) return NextResponse.next();
    return new NextResponse("Unauthorized — proxy header missing", { status: 401 });
  }

  // Native auth: verify the cookie's signature and expiry, not just presence.
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session && validateSessionToken(session)) return NextResponse.next();

  // No session — redirect browser requests to /login, return 401 for API calls
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|manifest.webmanifest).*)",
  ],
};
