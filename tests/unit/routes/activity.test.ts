import { describe, it, expect, beforeEach, vi } from "vitest";

// /api/activity's Lidarr source. Lidarr logs one "trackFileImported" per track,
// so an album landing would push everything else out of the 30-event feed;
// only the grab and the album-level "downloadImported" belong in it.

const fetchWithTimeout = vi.fn();
const creds = (configured: boolean, url: string) => ({ url, configured, apiKey: configured ? "k3y" : undefined });

beforeEach(() => {
  vi.resetModules();
  fetchWithTimeout.mockReset();
  vi.doMock("@/app/lib/http", () => ({ fetchWithTimeout }));
  vi.doMock("@/app/lib/server-config", () => ({
    loadConfig: async () => ({ services: {
      sonarr: creds(false, "http://sonarr"), radarr: creds(false, "http://radarr"),
      tautulli: creds(false, "http://tautulli"), lidarr: creds(true, "http://lidarr:8686"),
    } }),
  }));
});

describe("/api/activity — Lidarr", () => {
  it("keeps grabs and album imports, drops per-track imports, key in a header", async () => {
    const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const rec = (eventType: string, min: number) => ({
      eventType, date: at(min), quality: { quality: { name: "FLAC" } },
      artist: { artistName: "Khruangbin" }, album: { title: "Mordechai" },
    });
    fetchWithTimeout.mockResolvedValue(Response.json({ records: [
      rec("trackFileImported", 1), rec("trackFileImported", 1), rec("downloadImported", 1), rec("grabbed", 9),
    ] }));

    const { GET } = await import("@/app/api/activity/route");
    const { events } = await (await GET()).json();

    expect(events).toEqual([
      { source: "lidarr", type: "imported", title: "Khruangbin – Mordechai", subtitle: "FLAC", timestamp: Date.parse(at(1)) },
      { source: "lidarr", type: "grabbed",  title: "Khruangbin – Mordechai", subtitle: "FLAC", timestamp: Date.parse(at(9)) },
    ].map(e => ({ ...e, timestamp: expect.any(Number) })));
    const [url, opts] = fetchWithTimeout.mock.calls[0];
    expect(url).toMatch(/^http:\/\/lidarr:8686\/api\/v1\/history\?.*includeAlbum=true/);
    expect(url).not.toContain("k3y");
    expect(opts.headers["X-Api-Key"]).toBe("k3y");
  });
});
