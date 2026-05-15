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
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE  = "comexe_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

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

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// In-memory session store. Tokens survive within a single process lifetime,
// which is fine for a homelab dashboard — a container restart just means
// re-entering the password once.
const sessions = new Map<string, { hashedToken: string; createdAt: number }>();

function pruneExpired(): void {
  const cutoff = Date.now() - SESSION_MAX_AGE * 1000;
  for (const [key, val] of sessions) {
    if (val.createdAt < cutoff) sessions.delete(key);
  }
}

export function createSession(): string {
  pruneExpired();
  const token = randomBytes(32).toString("hex");
  sessions.set(hashToken(token), { hashedToken: hashToken(token), createdAt: Date.now() });
  return token;
}

export function validateSession(token: string): boolean {
  if (!token) return false;
  pruneExpired();
  const hashed = hashToken(token);
  return sessions.has(hashed);
}

export function destroySession(token: string): void {
  if (token) sessions.delete(hashToken(token));
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
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
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

// Read the session cookie value from a raw Cookie header (for middleware,
// which can't use next/headers cookies()).
export function getSessionFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
