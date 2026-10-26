import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetGlobalSingletons } from "../helpers/singletons";

// /api/services couldn't be imported in a test until its module-load
// setTimeout (which fired ten real upstream fetches) was removed. These cover
// the contract the dashboard depends on: unconfigured services never touch the
// network, a cold cache answers immediately with a placeholder, and a
// previously-good service is served stale rather than blank when it fails.

const NAMES = ["radarr","sonarr","bazarr","tautulli","qbittorrent","overseerr","pihole","prowlarr","nginx","uptimekuma"];

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
    expect(body.services).toHaveLength(10);
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
});
