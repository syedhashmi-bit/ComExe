import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Every write route must refuse a request that doesn't declare a JSON body.
//
// Why this is a security control rather than tidiness: none of these routes
// inspected Content-Type, and a cross-origin
//   fetch(url, { method: "POST", body: "{…}", headers: {"Content-Type":"text/plain"} })
// is a CORS *simple request* — no preflight — so any website the user visited
// could drive POST /api/config, /api/backup, /api/servers, /api/docker/restart
// and the rest. The attacker can't read the response, but the write lands.
// SameSite=lax covers this once auth is on; this closes the auth-off default,
// which is how the dashboard actually ships.
//
// The guard runs before any I/O, so these need no fs/network/config mocking —
// which is what makes covering all thirteen routes cheap.

const WRITE_ROUTES: [name: string, importPath: string, method: "POST" | "PATCH"][] = [
  ["POST /api/config",           "@/app/api/config/route",           "POST"],
  ["POST /api/backup",           "@/app/api/backup/route",           "POST"],
  ["POST /api/bookmarks",        "@/app/api/bookmarks/route",        "POST"],
  ["POST /api/custom-cards",     "@/app/api/custom-cards/route",     "POST"],
  ["POST /api/servers",          "@/app/api/servers/route",          "POST"],
  ["PATCH /api/servers",         "@/app/api/servers/route",          "PATCH"],
  ["POST /api/dependencies",     "@/app/api/dependencies/route",     "POST"],
  ["POST /api/alerts",           "@/app/api/alerts/route",           "POST"],
  ["PATCH /api/alerts",          "@/app/api/alerts/route",           "PATCH"],
  ["POST /api/history",          "@/app/api/history/route",          "POST"],
  ["POST /api/docker/restart",   "@/app/api/docker/restart/route",   "POST"],
  ["POST /api/mikrotik/wol",     "@/app/api/mikrotik/wol/route",     "POST"],
  ["POST /api/test-connection",  "@/app/api/test-connection/route",  "POST"],
  ["POST /api/auth/login",       "@/app/api/auth/login/route",       "POST"],
];

// The three content types a cross-origin page can send without a preflight.
const SIMPLE_REQUEST_TYPES = [
  "text/plain",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

beforeEach(() => {
  vi.resetModules();
  // Nothing should reach the network; fail loudly if the guard lets one past.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("guard let a request through to fetch()"); }));
});
afterEach(() => vi.unstubAllGlobals());

async function call(importPath: string, method: string, contentType?: string) {
  const mod = await import(importPath);
  const handler = mod[method] as (req: Request) => Promise<Response>;
  return handler(new Request("http://localhost:3000/x", {
    method,
    body: JSON.stringify({}),
    ...(contentType ? { headers: { "content-type": contentType } } : {}),
  }));
}

describe("write routes reject CSRF-capable content types", () => {
  for (const [name, importPath, method] of WRITE_ROUTES) {
    for (const ct of SIMPLE_REQUEST_TYPES) {
      it(`${name} refuses ${ct}`, async () => {
        const res = await call(importPath, method, ct);
        expect(res.status).toBe(415);
      });
    }

    it(`${name} refuses a request with no Content-Type`, async () => {
      const res = await call(importPath, method);
      expect(res.status).toBe(415);
    });
  }
});

describe("the guard does not block legitimate callers", () => {
  // Every in-app caller sends application/json. Anything other than 415 here
  // means the request got past the guard and into the handler proper, which is
  // all this needs to prove — the handler's own behaviour is covered elsewhere.
  for (const [name, importPath, method] of WRITE_ROUTES) {
    it(`${name} accepts application/json`, async () => {
      const res = await call(importPath, method, "application/json");
      expect(res.status).not.toBe(415);
    });

    it(`${name} accepts application/json with a charset parameter`, async () => {
      const res = await call(importPath, method, "application/json; charset=utf-8");
      expect(res.status).not.toBe(415);
    });
  }
});
