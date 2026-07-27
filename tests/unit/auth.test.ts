import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock next/headers cookies() — auth.ts imports it
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
  }),
}));

describe("auth", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DASHBOARD_PASSWORD;
    delete process.env.AUTH_PROXY_HEADER;
  });

  it("reports auth disabled when no env vars set", async () => {
    const { isAuthEnabled } = await import("@/app/lib/auth");
    expect(isAuthEnabled()).toBe(false);
  });

  it("reports auth enabled when DASHBOARD_PASSWORD set", async () => {
    process.env.DASHBOARD_PASSWORD = "secret123";
    const { isAuthEnabled } = await import("@/app/lib/auth");
    expect(isAuthEnabled()).toBe(true);
  });

  it("reports proxy mode when AUTH_PROXY_HEADER set", async () => {
    process.env.AUTH_PROXY_HEADER = "X-Authenticated-User";
    const { isAuthEnabled, isProxyMode } = await import("@/app/lib/auth");
    expect(isAuthEnabled()).toBe(true);
    expect(isProxyMode()).toBe(true);
  });

  it("verifies password with timing-safe comparison", async () => {
    process.env.DASHBOARD_PASSWORD = "correct-horse";
    const { verifyPassword } = await import("@/app/lib/auth");
    expect(verifyPassword("correct-horse")).toBe(true);
    expect(verifyPassword("wrong")).toBe(false);
    expect(verifyPassword("")).toBe(false);
  });

  it("creates and validates sessions", async () => {
    process.env.DASHBOARD_PASSWORD = "test";
    const { createSession, validateSession } = await import("@/app/lib/auth");
    const token = createSession();
    // <nonce>.<issuedAt>.<hmac>
    expect(token.split(".")).toHaveLength(3);
    expect(validateSession(token)).toBe(true);
    expect(validateSession("bogus")).toBe(false);
  });

  it("rejects an unsigned or tampered session token", async () => {
    process.env.DASHBOARD_PASSWORD = "test";
    const { createSession, validateSession } = await import("@/app/lib/auth");

    // Regression: the proxy used to accept ANY non-empty cookie value, so a
    // made-up token was a full auth bypass.
    expect(validateSession("anything")).toBe(false);
    expect(validateSession("a.b.c")).toBe(false);

    const token = createSession();
    const [nonce, issuedAt, sig] = token.split(".");
    // Flip the signature — must fail.
    expect(validateSession(`${nonce}.${issuedAt}.${"0".repeat(sig.length)}`)).toBe(false);
    // Re-date the token to extend its life — signature no longer matches.
    expect(validateSession(`${nonce}.${Number(issuedAt) + 60_000}.${sig}`)).toBe(false);
  });

  it("rejects expired session tokens", async () => {
    process.env.DASHBOARD_PASSWORD = "test";
    const { validateSession } = await import("@/app/lib/auth");
    const { SESSION_MAX_AGE } = await import("@/app/lib/session-token");
    const { createHash, createHmac } = await import("node:crypto");

    // Forge a correctly-signed token dated past the max age.
    const key = createHash("sha256").update("comexe-session-v1:test").digest("hex");
    const staleAt = Date.now() - (SESSION_MAX_AGE * 1000 + 60_000);
    const payload = `deadbeef.${staleAt}`;
    const sig = createHmac("sha256", key).update(payload).digest("hex");
    expect(validateSession(`${payload}.${sig}`)).toBe(false);
  });

  it("rejects sessions when no password is configured", async () => {
    process.env.DASHBOARD_PASSWORD = "test";
    const mod = await import("@/app/lib/auth");
    const token = mod.createSession();
    expect(mod.validateSession(token)).toBe(true);

    // Same token must not validate once native auth is turned off.
    vi.resetModules();
    delete process.env.DASHBOARD_PASSWORD;
    const fresh = await import("@/app/lib/auth");
    expect(fresh.validateSession(token)).toBe(false);
  });

  it("destroys sessions", async () => {
    process.env.DASHBOARD_PASSWORD = "test";
    const { createSession, validateSession, destroySession } = await import("@/app/lib/auth");
    const token = createSession();
    expect(validateSession(token)).toBe(true);
    destroySession(token);
    expect(validateSession(token)).toBe(false);
  });

  it("rate limits login attempts", async () => {
    const { checkRateLimit } = await import("@/app/lib/auth");
    const ip = "192.168.1.100";
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(ip)).toBe(true);
    }
    expect(checkRateLimit(ip)).toBe(false);
    // Different IP is unaffected
    expect(checkRateLimit("10.0.0.1")).toBe(true);
  });

  it("extracts session from cookie header", async () => {
    const { getSessionFromCookie } = await import("@/app/lib/auth");
    expect(getSessionFromCookie("comexe_session=abc123; other=xyz")).toBe("abc123");
    expect(getSessionFromCookie("other=xyz")).toBeNull();
    expect(getSessionFromCookie(null)).toBeNull();
  });
});
