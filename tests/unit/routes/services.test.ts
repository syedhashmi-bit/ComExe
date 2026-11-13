import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetGlobalSingletons } from "../helpers/singletons";

// /api/services couldn't be imported in a test until its module-load
// setTimeout (which fired ten real upstream fetches) was removed. These cover
// the contract the dashboard depends on: unconfigured services never touch the
// network, a cold cache answers immediately with a placeholder, and a
// previously-good service is served stale rather than blank when it fails.

const NAMES = ["radarr","sonarr","lidarr","bazarr","tautulli","qbittorrent","overseerr","nexbeat","pihole","prowlarr","nginx","uptimekuma"];

function creds(configured: boolean, url = "http://svc.invalid") {
  return { url, configured, apiKey: configured ? "k" : undefined, envVar: configured ? undefined : ["X_API_KEY"] };
}

function mockConfig(configured: Record<string, boolean>) {
  vi.doMock("@/app/lib/server-config", () => ({
    loadConfig: async () => ({
      services: Object.fromEntries(NAMES.map(n => [n, creds(configured[n] ?? false, `http://${n}.invalid`)])),
    }),
  }));
}

const fetchWithTimeout = vi.fn();

beforeEach(() => {
  vi.resetModules();
  resetGlobalSingletons();
  fetchWithTimeout.mockReset();
  vi.doMock("@/app/lib/http", () => ({
    fetchWithTimeout,
    fetchJson: vi.fn(async () => null),
  }));
});
afterEach(() => vi.useRealTimers());

describe("services module", () => {
  it("can be imported without starting any upstream work", async () => {
    mockConfig({});
    await import("@/app/lib/services");
    await import("@/app/api/services/route");
    await new Promise(r => setTimeout(r, 600));  // past the old 500ms warm-up delay
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("answers a cold cache immediately with a loading placeholder", async () => {
    mockConfig({});
    const { GET } = await import("@/app/api/services/route");
    const body = await GET().json();
    expect(body.loading).toBe(true);
    expect(body.services.map((s: { name: string }) => s.name)).toEqual(NAMES);
  });

  it("returns unconfigured cards without calling the network", async () => {
    mockConfig({});
    fetchWithTimeout.mockRejectedValue(new Error("ECONNREFUSED"));
    const { getServicesFresh } = await import("@/app/lib/services");
    const data = await getServicesFresh();

    // Uptime Kuma is the one exception by design: its API key is optional
    // (server-config marks it optionalAuth), so it always probes.
    const calledHosts = new Set(fetchWithTimeout.mock.calls.map(([url]) => new URL(url as string).hostname));
    expect([...calledHosts]).toEqual(["uptimekuma.invalid"]);

    expect(data?.services.map(s => s.name)).toEqual(NAMES);
    for (const s of data!.services.filter(s => s.name !== "uptimekuma")) {
      expect(s).toMatchObject({ up: false, configured: false, envVar: ["X_API_KEY"] });
    }
  });

  it("serves a recently-good service as stale when its next poll fails", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000, toFake: ["Date"] });
    mockConfig({ overseerr: true });
    const { getServicesFresh } = await import("@/app/lib/services");

    // Poll 1: Overseerr answers.
    fetchWithTimeout.mockImplementation(async () => Response.json({ pageInfo: { results: 3 } }));
    const first = await getServicesFresh();
    const good = first!.services.find(s => s.name === "overseerr")!;
    expect(good).toMatchObject({ up: true, lines: ["3 pending · 3 approved", "3 available"] });
    expect(good.stale).toBeUndefined();

    // Poll 2, 31s later (past the 30s cache): everything is unreachable.
    // Overseerr's counts are memoized for 3 min, so drop the memo to force the
    // refetch this test is about.
    vi.setSystemTime(Date.now() + 31_000);
    (globalThis as unknown as Record<symbol, { memo: Map<string, unknown> }>)[Symbol.for("comexe.services")].memo.clear();
    fetchWithTimeout.mockRejectedValue(new Error("ECONNREFUSED"));
    const second = await getServicesFresh();
    const stale = second!.services.find(s => s.name === "overseerr")!;
    expect(stale).toMatchObject({ up: true, stale: true, lines: good.lines });
  });

  it("reads Lidarr's library, queue and health over API v1, key in a header", async () => {
    mockConfig({ lidarr: true });
    const bodies: Record<string, unknown> = {
      "/api/v1/artist": [
        { statistics: { albumCount: 10, trackCount: 100, trackFileCount: 90, sizeOnDisk: 2e9 } },
        { statistics: { albumCount: 2,  trackCount: 20,  trackFileCount: 20, sizeOnDisk: 1e9 } },
      ],
      "/api/v1/wanted/missing": { totalRecords: 3 },
      "/api/v1/wanted/cutoff":  { totalRecords: 0 },
      "/api/v1/queue":          { totalRecords: 1, records: [{ title: "Khruangbin – A La Sala", size: 100, sizeleft: 25, timeleft: "00:10:00" }] },
      "/api/v1/health":         [{ type: "warning", message: "Indexers unavailable" }],
    };
    fetchWithTimeout.mockImplementation(async (url: string) => Response.json(bodies[new URL(url).pathname] ?? null));
    const { getServicesFresh } = await import("@/app/lib/services");
    const lidarr = (await getServicesFresh())!.services.find(s => s.name === "lidarr")!;

    expect(lidarr).toMatchObject({
      up: true, pct: 92,
      lines: ["2 artists · 3.0 GB", "12 albums · 3 missing albums", "1 in queue"],
      queueItems: [{ title: "Khruangbin – A La Sala", pct: 75, etaSec: 600 }],
      health: { warning: 1, error: 0, messages: ["Indexers unavailable"] },
    });
    for (const [url, opts] of fetchWithTimeout.mock.calls.filter(([u]) => String(u).includes("lidarr"))) {
      expect(url).not.toContain("apiKey");
      expect((opts as { headers: Record<string, string> }).headers["X-Api-Key"]).toBe("k");
    }
  });

  it("shows nexbeat's request counts, with failed requests as a warning", async () => {
    mockConfig({ nexbeat: true });
    fetchWithTimeout.mockImplementation(async () => Response.json({
      requests_enabled: true,
      requests: { waiting: 2, running: 1, failed: 1, done_last_7_days: 5 },
      library:  { artists: 212, albums: 1904 },
    }));
    const { getServicesFresh } = await import("@/app/lib/services");
    const nexbeat = (await getServicesFresh())!.services.find(s => s.name === "nexbeat")!;

    expect(nexbeat).toMatchObject({
      up: true,
      lines: ["2 waiting · 1 running", "5 done this week · 212 artists · 1904 albums"],
      health: { warning: 1, error: 0 },
    });
    const [url, opts] = fetchWithTimeout.mock.calls.find(([u]) => String(u).includes("nexbeat"))!;
    expect(url).toBe("http://nexbeat.invalid/api/v1/dashboard");
    expect((opts as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer k");
  });

  it("says when nexbeat's requests aren't set up, and stays quiet with none failed", async () => {
    const { nexbeatResult } = await import("@/app/lib/services");
    const r = nexbeatResult({ requests_enabled: false, requests: { waiting: 0, running: 0, failed: 0 } }, "http://n");
    expect(r.lines).toEqual(["0 waiting · 0 running", "requests not set up"]);
    expect(r.health).toBeUndefined();
  });

  it("marks a wrong nexbeat token as an auth error, not as down", async () => {
    mockConfig({ nexbeat: true });
    fetchWithTimeout.mockImplementation(async () => new Response("", { status: 401 }));
    const { getServicesFresh } = await import("@/app/lib/services");
    const nexbeat = (await getServicesFresh())!.services.find(s => s.name === "nexbeat")!;
    expect(nexbeat).toMatchObject({ up: true, authError: true, lines: ["check api token"] });
  });
});
