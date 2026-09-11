import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { createSessionToken, SESSION_COOKIE } from "@/app/lib/session-token";

// proxy() reads process.env inside the handler (not at module scope), so these
// can be flipped per test without resetting modules.
const ORIGINAL = { ...process.env };

function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

// NextResponse.next() carries the x-middleware-next marker; a blocked request
// is either a 401 or a redirect to /login.
const allowed = (res: Response) => res.headers.has("x-middleware-next");

beforeEach(() => {
  delete process.env.DASHBOARD_PASSWORD;
  delete process.env.AUTH_PROXY_HEADER;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("proxy — auth disabled (the default)", () => {
  it("lets everything through", () => {
    expect(allowed(proxy(req("/")))).toBe(true);
    expect(allowed(proxy(req("/api/metrics")))).toBe(true);
    expect(allowed(proxy(req("/api/backup")))).toBe(true);
  });
});

describe("proxy — native auth enabled", () => {
  beforeEach(() => { process.env.DASHBOARD_PASSWORD = "hunter2"; });

  // THE REGRESSION THIS FILE EXISTS FOR.
  //
  // The Dockerfile HEALTHCHECK probes /api/health with no cookie. When this
  // path was not in PUBLIC_PATHS, setting DASHBOARD_PASSWORD made the probe
  // 401 → container unhealthy after ~90s → scripts/update-dashboard.sh never
  // promotes the candidate and rolls back every deploy. Enabling auth silently
  // broke deployment; nothing surfaced the connection.
  it("leaves /api/health public so the container HEALTHCHECK still passes", () => {
    expect(allowed(proxy(req("/api/health")))).toBe(true);
  });

  it("leaves the login flow and PWA assets public", () => {
    for (const p of ["/login", "/api/auth/login", "/api/auth/status", "/sw.js", "/icon.svg", "/manifest.webmanifest"]) {
      expect(allowed(proxy(req(p))), `${p} should be public`).toBe(true);
    }
  });

  it("401s an unauthenticated API call", () => {
    const res = proxy(req("/api/metrics"));
    expect(res.status).toBe(401);
  });

  it("redirects an unauthenticated page request to /login", () => {
    const res = proxy(req("/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  // The bug this replaced: the proxy checked only that the cookie EXISTED, so
  // `comexe_session=x` was a full bypass.
  it("rejects a forged session cookie", () => {
    const res = proxy(req("/api/metrics", `${SESSION_COOKIE}=not-a-real-token`));
    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed session cookie", () => {
    const token = createSessionToken();
    expect(allowed(proxy(req("/api/metrics", `${SESSION_COOKIE}=${token}`)))).toBe(true);
  });

  it("does not treat a path merely prefixed with a public one as public", () => {
    expect(proxy(req("/loginsomething")).status).toBe(307);
  });
});

describe("proxy — reverse-proxy header mode", () => {
  beforeEach(() => { process.env.AUTH_PROXY_HEADER = "X-Authenticated-User"; });

  it("allows a request carrying the configured header", () => {
    const r = new NextRequest("http://localhost:3000/api/metrics", {
      headers: { "X-Authenticated-User": "syed" },
    });
    expect(allowed(proxy(r))).toBe(true);
  });

  it("401s when the header is absent", () => {
    expect(proxy(req("/api/metrics")).status).toBe(401);
  });
});
