import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson, fetchWithTimeout } from "@/app/lib/http";

afterEach(() => vi.restoreAllMocks());

describe("fetchJson", () => {
  it("returns parsed JSON on a 2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hello: "world" }),
    }));
    expect(await fetchJson("http://x")).toEqual({ hello: "world" });
  });

  it("returns null on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ should: "not be read" }),
    }));
    expect(await fetchJson("http://x")).toBeNull();
  });

  it("returns null when the fetch rejects (network/timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await fetchJson("http://x")).toBeNull();
  });

  it("returns null when the body is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    }));
    expect(await fetchJson("http://x")).toBeNull();
  });
});

describe("fetchWithTimeout", () => {
  it("defaults cache to no-store and attaches a timeout signal", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", spy);
    await fetchWithTimeout("http://x", { headers: { A: "b" } });

    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("http://x");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toEqual({ A: "b" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("lets a caller-supplied signal take precedence over the timeout", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", spy);
    const ctrl = new AbortController();
    await fetchWithTimeout("http://x", { signal: ctrl.signal });
    expect(spy.mock.calls[0][1].signal).toBe(ctrl.signal);
  });
});
