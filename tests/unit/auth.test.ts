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
    expect(token).toHaveLength(64); // 32 bytes hex
    expect(validateSession(token)).toBe(true);
    expect(validateSession("bogus")).toBe(false);
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
