// ── Authentication helpers ──────────────────────────────────────────────────
// Two modes, controlled by env vars:
//
//   1. Native basic auth — DASHBOARD_PASSWORD env var. Single shared password,
//      cookie-based session. Good for LAN-only setups that want a lock screen.
//
//   2. Reverse-proxy mode — AUTH_PROXY_HEADER env var (e.g. "X-Authenticated-User").
//      Trust the upstream proxy (Authelia, Authentik, Cloudflare Access) to set
//      the header. No login page needed — the proxy handles it.
//
// When neither env var is set, auth is disabled (current behavior, fine for LAN).
//
// IMPORTANT: server-only. Never import from "use client" modules.

import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import {
  SESSION_COOKIE, SESSION_MAX_AGE,
  createSessionToken, validateSessionToken,
  getSessionFromCookie,
} from "@/app/lib/session-token";

function getPassword(): string {
  return (process.env.DASHBOARD_PASSWORD ?? "").trim();
}

function getProxyHeader(): string {
  return (process.env.AUTH_PROXY_HEADER ?? "").trim();
}

export function isAuthEnabled(): boolean {
  return getPassword().length > 0 || getProxyHeader().length > 0;
}

export function isProxyMode(): boolean {
  return getProxyHeader().length > 0;
}

// Session handling lives in `session-token.ts` (HMAC-signed, stateless) so the
// proxy can verify tokens too — it can't import this module because of the
// `next/headers` dependency below.
export function createSession(): string {
  return createSessionToken();
}

export function validateSession(token: string): boolean {
  return validateSessionToken(token);
}

export function verifyPassword(input: string): boolean {
  const expected = getPassword();
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Rate limiting — simple sliding-window counter per IP.
const loginAttempts = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW = 60_000; // 1 minute
const RATE_LIMIT  = 10;     // attempts per window

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Drop windows that have already expired — otherwise the map grows one entry
  // per distinct source IP for the lifetime of the process.
  for (const [key, val] of loginAttempts) {
    if (now - val.windowStart > RATE_WINDOW) loginAttempts.delete(key);
  }

  const entry = loginAttempts.get(ip);
  if (!entry) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// Check whether the current request is authenticated. Used by middleware.
export async function isAuthenticated(request: Request): Promise<boolean> {
  if (!isAuthEnabled()) return true;

  // Reverse-proxy mode: trust the configured header
  const proxyHeader = getProxyHeader();
  if (proxyHeader) {
    const user = request.headers.get(proxyHeader);
    return !!user && user.trim().length > 0;
  }

  // Native auth: check session cookie
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) return false;
  return validateSession(sessionToken);
}

export { SESSION_COOKIE, SESSION_MAX_AGE, getSessionFromCookie };
