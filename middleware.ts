import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware runs on the Edge runtime, so we can't import Node crypto helpers
// directly. Instead we do lightweight cookie checks here and let the API routes
// do the heavy crypto validation. This keeps the middleware fast and avoids
// Edge runtime incompatibilities.

const SESSION_COOKIE = "comexe_session";

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

export function middleware(request: NextRequest) {
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

  // Native auth: check session cookie exists (full validation happens in routes)
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session) return NextResponse.next();

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
