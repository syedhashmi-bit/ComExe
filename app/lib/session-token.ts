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

// Explicitly revoked tokens (logout). Pruned on access so it can't grow without
// bound; entries are pointless past the token's own expiry anyway.
const revoked = new Map<string, number>();

function pruneRevoked(): void {
  const cutoff = Date.now() - SESSION_MAX_AGE * 1000;
  for (const [token, revokedAt] of revoked) {
    if (revokedAt < cutoff) revoked.delete(token);
  }
}

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

  pruneRevoked();
  return !revoked.has(token);
}

export function revokeSessionToken(token: string): void {
  if (!token) return;
  pruneRevoked();
  revoked.set(token, Date.now());
}

// Read the session cookie from a raw Cookie header (the proxy and any non-
// `next/headers` context).
export function getSessionFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}
