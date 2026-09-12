import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchWithTimeout } from "@/app/lib/http";
import { resetCircuits, recordFailure, snapshot, CircuitOpenError } from "@/app/lib/circuit-breaker";

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

// ── skipBreaker ─────────────────────────────────────────────────────────────
// Added for /api/test-connection. The wizard's "Test" button is a manual probe,
// and the circuit for a service is open exactly when that service has been
// failing — which is what sends someone to the wizard. Without an opt-out, Test
// would report "circuit open" instead of testing the user's new API key.
describe("fetchWithTimeout — skipBreaker", () => {
  beforeEach(() => resetCircuits());
  afterEach(() => resetCircuits());

  const open = async (origin: string) => {
    // 5 consecutive failures is FAILURE_THRESHOLD.
    for (let i = 0; i < 5; i++) recordFailure(origin, "boom");
  };

  it("normally refuses to call an origin whose circuit is open", async () => {
    await open("http://dead.test");
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", spy);

    await expect(fetchWithTimeout("http://dead.test/api")).rejects.toBeInstanceOf(CircuitOpenError);
    expect(spy).not.toHaveBeenCalled();   // the point: no traffic generated
  });

  it("still calls through an open circuit when skipBreaker is set", async () => {
    await open("http://dead.test");
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", spy);

    const res = await fetchWithTimeout("http://dead.test/api", { skipBreaker: true });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("does not record skipBreaker calls against the origin", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("refused")));

    // Deliberately testing a known-down service must not push its circuit open.
    for (let i = 0; i < 10; i++) {
      await fetchWithTimeout("http://probe.test/api", { skipBreaker: true }).catch(() => {});
    }
    expect(snapshot().find(o => o.origin === "http://probe.test")).toBeUndefined();
  });

  it("still records normal calls, so the breaker keeps working", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("refused")));
    for (let i = 0; i < 5; i++) {
      await fetchWithTimeout("http://real.test/api").catch(() => {});
    }
    expect(snapshot().find(o => o.origin === "http://real.test")?.state).toBe("open");
  });
});
