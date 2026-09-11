// ── Session tokens (HMAC-signed, stateless) ──────────────────────────────────
// Deliberately dependency-free (node:crypto only) so BOTH `proxy.ts` and the
// API routes can import it. `auth.ts` can't be imported by the proxy because it
// pulls in `next/headers`, which isn't available there — that split is why the
// proxy previously did nothing but an existence check on the cookie.
//
// Why signed instead of a random token + in-memory Set:
//   1. The proxy and the route handlers are bundled separately, so they can't
//      be relied on to share module state. A signed token needs no shared state
//      — the proxy can verify it on its own.
//   2. Sessions survive a container restart, so a deploy no longer forces
//      everyone to log in again.
//
// The signing key is derived from DASHBOARD_PASSWORD, so changing the password
// invalidates every outstanding session for free.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE  = "comexe_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds

function getPassword(): string {
  return (process.env.DASHBOARD_PASSWORD ?? "").trim();
}

function signingKey(): string {
  return createHash("sha256").update(`comexe-session-v1:${getPassword()}`).digest("hex");
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

// ── On logout and revocation ────────────────────────────────────────────────
//
// There used to be a module-level `revoked` Map here that `validateSessionToken`
// consulted and `POST /api/auth/logout` wrote to. It never worked, for the exact
// reason stated at the top of this file: the proxy and the route handlers are
// bundled separately and do not share module state. The proxy's copy of the Map
// was a different instance and stayed permanently empty, so a token captured
// before logout remained valid at the only enforcement point (proxy.ts) for the
// full 7 days. It also reset on every container restart.
//
// Rather than keep code that reads as a security control and isn't one, the list
// is gone. Logout now does exactly what it appears to do and nothing more:
// clears the browser's cookie.
//
// The revocation mechanism that DOES work is changing DASHBOARD_PASSWORD — the
// signing key is derived from it (see signingKey above), so a new password
// invalidates every outstanding token instantly and statelessly.
//
// If per-session revocation is ever actually needed, it has to be shared state
// both bundles can see — a file under data/ via lib/json-store.ts, read by the
// proxy behind a short TTL cache. That is a real cost on the auth hot path and
// was not worth it for a single-user LAN deployment.

// Token format: <nonce>.<issuedAtMs>.<hmac>
export function createSessionToken(): string {
  const payload = `${randomBytes(16).toString("hex")}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function validateSessionToken(token: string): boolean {
  // No password configured means native auth isn't in use — never accept a
  // token signed with the empty-password key.
  if (!token || !getPassword()) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [nonce, issuedAtRaw, sig] = parts;

  const expected = sign(`${nonce}.${issuedAtRaw}`);
  // timingSafeEqual throws on length mismatch, so length-check first.
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > SESSION_MAX_AGE * 1000) return false;

  return true;
}

// Read the session cookie from a raw Cookie header (the proxy and any non-
// `next/headers` context).
export function getSessionFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}
