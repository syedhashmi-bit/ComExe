import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetGlobalSingletons } from "../helpers/singletons";

// /api/services couldn't be imported in a test until its module-load
// setTimeout (which fired ten real upstream fetches) was removed. These cover
// the contract the dashboard depends on: unconfigured services never touch the
// network, a cold cache answers immediately with a placeholder, and a
// previously-good service is served stale rather than blank when it fails.

const NAMES = ["radarr","sonarr","lidarr","bazarr","tautulli","qbittorrent","sabnzbd","overseerr","nexbeat","pihole","prowlarr","nginx","uptimekuma","scrutiny"];

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
  it("reads SABnzbd's queue, and counts only the last day's failures", async () => {
    mockConfig({ sabnzbd: true });
    const now = Date.now() / 1000;
    fetchWithTimeout.mockImplementation(async (url: string) => {
      const mode = new URL(url).searchParams.get("mode");
      return Response.json(mode === "queue"
        ? { queue: { paused: false, kbpersec: "43110.4", mbleft: "6400", diskspace1: "812.33", noofslots: 2,
            slots: [{ filename: "Severance.S02E09", percentage: "58", timeleft: "0:02:20" }] } }
        : { history: { slots: [{ completed: now - 3600 }, { completed: now - 3 * 86_400 }] } });
    });
    const { getServicesFresh } = await import("@/app/lib/services");
    const sab = (await getServicesFresh())!.services.find(s => s.name === "sabnzbd")!;

    expect(sab).toMatchObject({
      up: true,
      lines: ["↓ 44 MB/s", "2 in queue · 6.4 GB left · 812 GB free"],
      queueItems: [{ title: "Severance.S02E09", pct: 58, etaSec: 140 }],
      health: { warning: 1, error: 0, messages: ["1 download failed in the last day"] },
    });
  });

  it("treats SABnzbd's HTTP 200 'API Key Incorrect' as an auth error", async () => {
    mockConfig({ sabnzbd: true });
    fetchWithTimeout.mockImplementation(async () => Response.json({ status: false, error: "API Key Incorrect" }));
    const { getServicesFresh } = await import("@/app/lib/services");
    const sab = (await getServicesFresh())!.services.find(s => s.name === "sabnzbd")!;
    expect(sab).toMatchObject({ up: true, authError: true, lines: ["check api key"] });
  });

  it("shows SABnzbd paused, and idle with nothing queued", async () => {
    const { sabnzbdResult } = await import("@/app/lib/services");
    expect(sabnzbdResult({ queue: { paused: true, kbpersec: "0" } }, 0, "http://s").lines).toEqual(["Paused"]);
    expect(sabnzbdResult({ queue: { paused: false, kbpersec: "0", noofslots: 0 } }, 0, "http://s")).toMatchObject({ lines: ["Idle"], health: undefined });
  });

  it("makes a drive Scrutiny flags an error, and a silent collector a warning", async () => {
    const { scrutinyResult } = await import("@/app/lib/services");
    const now = Date.parse("2026-11-21T12:00:00Z");
    const drive = (name: string, status: number, collected: string) => ({
      device: { wwn: "w-" + name, device_name: name, model_name: "WDC WD80EFAX", device_status: status },
      smart: { collector_date: collected },
    });
    const ok = scrutinyResult({ data: { summary: { a: drive("sda", 0, "2026-11-21T06:00:00Z"), b: drive("sdb", 0, "2026-11-21T06:00:00Z") } } }, "http://s", now);
    expect(ok).toMatchObject({ lines: ["2 drives · all passed", "read 6h ago"], health: undefined });

    const bad = scrutinyResult({ data: { summary: { a: drive("sda", 3, "2026-11-18T06:00:00Z"), b: drive("sdb", 0, "2026-11-18T06:00:00Z") } } }, "http://s", now);
    expect(bad.lines).toEqual(["1 of 2 drives failing", "read 3d ago"]);
    expect(bad.health).toEqual({
      error: 1, warning: 1,
      messages: ["sda (WDC WD80EFAX) failed SMART and Scrutiny's check", "Scrutiny's collector hasn't reported in over two days"],
    });
  });

  it("reads Scrutiny's summary without a key", async () => {
    mockConfig({ scrutiny: true });
    fetchWithTimeout.mockImplementation(async () => Response.json({ success: true, data: { summary: {} } }));
    const { getServicesFresh } = await import("@/app/lib/services");
    const scr = (await getServicesFresh())!.services.find(s => s.name === "scrutiny")!;
    expect(scr).toMatchObject({ up: true, lines: ["0 drives · all passed"] });
    const [url, opts] = fetchWithTimeout.mock.calls.find(([u]) => String(u).includes("scrutiny"))!;
    expect(url).toBe("http://scrutiny.invalid/api/summary");
    expect(Object.keys((opts as { headers: Record<string, string> }).headers)).toEqual(["Accept"]);
  });
});
