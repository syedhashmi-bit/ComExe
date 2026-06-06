import { describe, it, expect, vi, afterEach } from "vitest";
import { promScalar, promVector } from "@/app/lib/prometheus";

afterEach(() => vi.restoreAllMocks());

describe("promScalar", () => {
  it("parses the first series' value as a number", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: [{ metric: {}, value: [123, "45.6"] }] } }),
    }));
    expect(await promScalar("http://prom", "up")).toBe(45.6);
  });

  it("returns null when the result set is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: [] } }),
    }));
    expect(await promScalar("http://prom", "up")).toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    expect(await promScalar("http://prom", "up")).toBeNull();
  });

  it("URL-encodes the query", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { result: [] } }) });
    vi.stubGlobal("fetch", spy);
    await promScalar("http://prom", 'node_cpu{mode="idle"}');
    const url = spy.mock.calls[0][0] as string;
    expect(url.startsWith("http://prom/api/v1/query?query=")).toBe(true);
    expect(url).toContain(encodeURIComponent('node_cpu{mode="idle"}'));
  });
});

describe("promVector", () => {
  it("maps every series to { metric, value }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: [
        { metric: { device: "sda" }, value: [1, "10"] },
        { metric: { device: "sdb" }, value: [1, "20"] },
      ] } }),
    }));
    expect(await promVector("http://prom", "node_x")).toEqual([
      { metric: { device: "sda" }, value: 10 },
      { metric: { device: "sdb" }, value: 20 },
    ]);
  });

  it("returns an empty array on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await promVector("http://prom", "x")).toEqual([]);
  });

  it("defaults a missing metric label bag to {}", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: [{ value: [1, "5"] }] } }),
    }));
    expect(await promVector("http://prom", "x")).toEqual([{ metric: {}, value: 5 }]);
  });
});
