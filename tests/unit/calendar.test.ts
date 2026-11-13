import { describe, it, expect, beforeEach, vi } from "vitest";
import { dayKeyOf, isMissing, itemState } from "@/app/components/ComingUp";
import type { CalendarItem } from "@/app/lib/types";

// /api/calendar and the "Coming up" card: the *arr responses mapped to items,
// the API key kept out of the URL, and the card's grouping and wording.

const DAY = 86_400_000;
const calls: { url: string; headers: Record<string, string> }[] = [];
let responses: Record<string, unknown> = {};

const creds = (url: string, configured = true) => ({ url, apiKey: "k3y", configured });

beforeEach(() => {
  vi.resetModules();
  calls.length = 0;
  responses = {};
  vi.doMock("@/app/lib/server-config", () => ({
    loadConfig: async () => ({ services: {
      sonarr: creds("http://sonarr:8989"), radarr: creds("http://radarr:7878"), lidarr: creds("http://lidarr:8686"),
    } }),
  }));
  vi.doMock("@/app/lib/http", () => ({
    fetchJson: async (url: string, opts: { headers: Record<string, string> }) => {
      calls.push({ url, headers: opts.headers });
      return responses[new URL(url).host] ?? null;
    },
  }));
});

describe("sonarrItems / radarrItems", () => {
  it("maps episodes to a series title and SxxEyy", async () => {
    const { sonarrItems } = await import("@/app/lib/calendar");
    expect(sonarrItems([
      { series: { title: "The Bear" }, seasonNumber: 4, episodeNumber: 9, airDateUtc: "2026-10-29T08:00:00Z", hasFile: true },
      { series: { title: "No date" }, seasonNumber: 1, episodeNumber: 1 },
    ])).toEqual([
      { source: "sonarr", kind: "episode", title: "The Bear", detail: "S04E09", at: Date.parse("2026-10-29T08:00:00Z"), hasFile: true },
    ]);
  });

  it("emits a movie once per release date inside the window", async () => {
    const { radarrItems } = await import("@/app/lib/calendar");
    const from = Date.parse("2026-10-22T00:00:00Z"), to = Date.parse("2026-11-05T00:00:00Z");
    const items = radarrItems([{
      title: "Dune: Part Three", year: 2026,
      inCinemas: "2026-09-01T00:00:00Z",         // outside the window
      digitalRelease: "2026-11-02T00:00:00Z",
    }], from, to);
    expect(items).toEqual([{
      source: "radarr", kind: "digital", title: "Dune: Part Three (2026)", detail: "",
      at: Date.parse("2026-11-02T00:00:00Z"), hasFile: false, allDay: true,
    }]);
  });

  it("names an album by artist, and counts it downloaded only when every track is", async () => {
    const { lidarrItems } = await import("@/app/lib/calendar");
    const from = Date.parse("2026-10-22T00:00:00Z"), to = Date.parse("2026-11-05T00:00:00Z");
    const album = (title: string, stats: { trackFileCount: number; trackCount: number }, releaseDate = "2026-11-01T00:00:00Z") =>
      ({ title, releaseDate, artist: { artistName: "Khruangbin" }, statistics: stats });
    expect(lidarrItems([
      album("A La Sala", { trackFileCount: 6, trackCount: 12 }),
      album("Mordechai", { trackFileCount: 10, trackCount: 10 }),
      album("Con Todo El Mundo", { trackFileCount: 0, trackCount: 10 }, "2018-01-26T00:00:00Z"),   // outside
    ], from, to)).toEqual([
      { source: "lidarr", kind: "album", title: "Khruangbin – A La Sala", detail: "", at: Date.parse("2026-11-01T00:00:00Z"), hasFile: false, allDay: true },
      { source: "lidarr", kind: "album", title: "Khruangbin – Mordechai", detail: "", at: Date.parse("2026-11-01T00:00:00Z"), hasFile: true, allDay: true },
    ]);
  });
});

describe("getCalendar", () => {
  it("asks each app for ±7 days with the key in a header, not the URL", async () => {
    responses = {
      "sonarr:8989": [{ series: { title: "Shogun" }, seasonNumber: 2, episodeNumber: 5, airDateUtc: new Date(Date.now() + DAY).toISOString() }],
      "radarr:7878": [],
      "lidarr:8686": [{ title: "A La Sala", releaseDate: new Date(Date.now() + 2 * DAY).toISOString(), artist: { artistName: "Khruangbin" } }],
    };
    const { getCalendar } = await import("@/app/lib/calendar");
    const feed = await getCalendar();

    expect(feed.sources).toEqual({ sonarr: "ok", radarr: "ok", lidarr: "ok" });
    expect(feed.items.map(i => i.title)).toEqual(["Shogun", "Khruangbin – A La Sala"]);
    for (const c of calls) {
      expect(c.url).toMatch(/\/api\/v[13]\/calendar\?start=/);
      expect(c.url).not.toContain("k3y");
      expect(c.headers["X-Api-Key"]).toBe("k3y");
    }
    expect(calls.find(c => c.url.startsWith("http://sonarr"))!.url).toContain("includeSeries=true");
    expect(calls.find(c => c.url.startsWith("http://lidarr"))!.url).toMatch(/\/api\/v1\/calendar\?.*includeArtist=true/);
  });

  it("reports an unreachable app as an error rather than an empty week", async () => {
    responses = { "radarr:7878": [], "lidarr:8686": [] };
    const { getCalendar } = await import("@/app/lib/calendar");
    expect((await getCalendar()).sources).toEqual({ sonarr: "error", radarr: "ok", lidarr: "ok" });
  });
});

describe("Coming up card helpers", () => {
  const ep = (over: Partial<CalendarItem> = {}): CalendarItem =>
    ({ source: "sonarr", kind: "episode", title: "Shogun", detail: "S02E05", at: 0, hasFile: false, ...over });

  it("groups release dates by their UTC date, whatever the timezone", () => {
    const movie = ep({ source: "radarr", kind: "digital", detail: "", at: Date.parse("2026-11-02T00:00:00Z"), allDay: true });
    expect(dayKeyOf(movie, "America/New_York")).toBe("2026-11-02");
    // An air time is an instant: 01:00 UTC is still the previous day in New York.
    expect(dayKeyOf(ep({ at: Date.parse("2026-11-02T01:00:00Z") }), "America/New_York")).toBe("2026-11-01");
  });

  it("calls an episode missing only once it's a day past airing with no file", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect(isMissing(ep({ at: now - 2 * DAY }), now)).toBe(true);
    expect(isMissing(ep({ at: now - 3_600_000 }), now)).toBe(false);        // probably still downloading
    expect(isMissing(ep({ at: now - 2 * DAY, hasFile: true }), now)).toBe(false);
    expect(isMissing(ep({ kind: "cinema", at: now - 2 * DAY }), now)).toBe(false);
  });

  it("says downloaded, a time, or what kind of release", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    expect(itemState(ep({ at: now - 1000, hasFile: true }), now, "UTC")).toEqual({ text: "Downloaded", done: true });
    expect(itemState(ep({ at: now - 1000 }), now, "UTC").text).toBe("Aired");
    expect(itemState(ep({ at: now + DAY, kind: "digital" }), now, "UTC").text).toBe("Digital release");
    expect(itemState(ep({ at: now + DAY, kind: "album", source: "lidarr" }), now, "UTC").text).toBe("Album release");
    expect(itemState(ep({ at: now - DAY, kind: "album", source: "lidarr" }), now, "UTC").text).toBe("Released");
    expect(itemState(ep({ at: Date.parse("2026-10-29T21:00:00Z") }), now, "UTC").text).toMatch(/9:00/);
  });
});
