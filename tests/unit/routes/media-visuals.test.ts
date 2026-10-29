import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetGlobalSingletons } from "../helpers/singletons";

// The Now playing detail (Tautulli session → stream), the poster proxy's
// guard rails, and the speedtest history points.

const fetchWithTimeout = vi.fn();
const fetchJson = vi.fn();

beforeEach(() => {
  vi.resetModules();
  resetGlobalSingletons();
  fetchWithTimeout.mockReset();
  fetchJson.mockReset();
  vi.doMock("@/app/lib/http", () => ({ fetchWithTimeout, fetchJson }));
  vi.doMock("@/app/lib/server-config", () => ({
    loadConfig: async () => ({
      services: {
        tautulli:  { url: "http://tautulli:8181", apiKey: "t0k", configured: true },
        speedtest: { url: "http://speedtest", apiKey: "", configured: true },
      },
    }),
  }));
});

describe("streamDetail", () => {
  it("describes a GPU transcode with the source → stream resolution", async () => {
    const { streamDetail } = await import("@/app/lib/services");
    expect(streamDetail({
      media_type: "movie", thumb: "/library/metadata/4242/thumb/1700000000",
      transcode_decision: "transcode", transcode_hw_encoding: 1,
      video_full_resolution: "4k", stream_video_full_resolution: "1080",
      bandwidth: "10000", player: "iPad", state: "playing",
    })).toEqual({
      art: "/library/metadata/4242/thumb/1700000000", decision: "Transcode", hwTranscode: true,
      quality: "4K → 1080p", bitrateKbps: 10000, player: "iPad", paused: undefined,
    });
  });

  it("uses the show's poster for an episode and reads direct play plainly", async () => {
    const { streamDetail } = await import("@/app/lib/services");
    const d = streamDetail({
      media_type: "episode", thumb: "/library/metadata/9/thumb/1", grandparent_thumb: "/library/metadata/7/thumb/2",
      transcode_decision: "direct play", stream_video_full_resolution: "1080p", state: "paused", product: "Plex for LG",
    });
    expect(d).toMatchObject({ art: "/library/metadata/7/thumb/2", decision: "Direct play", quality: "1080p", paused: true, player: "Plex for LG" });
    expect(d.hwTranscode).toBeUndefined();
  });

  it("drops artwork paths that aren't Plex library images", async () => {
    const { streamDetail } = await import("@/app/lib/services");
    expect(streamDetail({ media_type: "movie", thumb: "http://evil.example/x.png" }).art).toBeUndefined();
  });
});

describe("/api/plex-art", () => {
  const get = async (qs: string) => {
    const { GET } = await import("@/app/api/plex-art/route");
    return GET(new Request(`http://localhost/api/plex-art?${qs}`));
  };

  it("refuses anything but a Plex library image path, without calling out", async () => {
    for (const img of ["http://evil.example/a.png", "/library/metadata/1/../../etc", "/status/sessions"]) {
      expect((await get(`img=${encodeURIComponent(img)}`)).status).toBe(400);
    }
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("fetches through Tautulli, clamps the size, and won't pass on non-raster types", async () => {
    fetchWithTimeout.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } }));
    const ok = await get(`img=${encodeURIComponent("/library/metadata/5/thumb/9")}&w=9999&h=1`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    const called = String(fetchWithTimeout.mock.calls[0][0]);
    expect(called).toContain("cmd=pms_image_proxy");
    expect(called).toContain("width=400&height=60");

    fetchWithTimeout.mockResolvedValueOnce(new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }));
    expect((await get(`img=${encodeURIComponent("/library/metadata/6/thumb/9")}`)).status).toBe(502);
  });
});

describe("/api/speedtest history points", () => {
  it("returns the last tests oldest-first, in Mbps", async () => {
    fetchJson.mockResolvedValueOnce({
      data: [
        { download: 56_250_000, upload: 5_000_000, ping: 8.2, created_at: "2026-10-29T10:00:00Z" },
        { download: 55_000_000, upload: 4_875_000, ping: 9.1, created_at: "2026-10-29T06:00:00Z" },
      ],
      meta: { total: 2 },
    });
    const { GET } = await import("@/app/api/speedtest/route");
    const body = await (await GET()).json();
    expect(body.tests).toEqual([
      { ts: Date.parse("2026-10-29T06:00:00Z"), download: 440, upload: 39, ping: 9.1 },
      { ts: Date.parse("2026-10-29T10:00:00Z"), download: 450, upload: 40, ping: 8.2 },
    ]);
    expect(String(fetchJson.mock.calls[0][0])).toContain("page%5Bsize%5D=20");
  });
});
