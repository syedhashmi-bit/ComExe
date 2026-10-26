import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetGlobalSingletons } from "./helpers/singletons";

// The collector is what makes alerts fire and history record with no browser
// open. The properties that matter: it polls upstreams only when nobody is
// connected (SSE already polls otherwise), idle polling respects its cadence,
// fires reach the SSE emitter, and it can be switched off.

const getMetrics       = vi.fn(async () => ({ cpu: 1 }));
const peekMetrics      = vi.fn(() => ({ cpu: 2 }));
const getServicesFresh = vi.fn(async () => ({ services: [], timestamp: 0 }));
const peekServices     = vi.fn(() => ({ services: [], timestamp: 0 }));
const evaluateAndDispatch = vi.fn(async (): Promise<{ fires: unknown[]; quiet: boolean }> => ({ fires: [], quiet: false }));

beforeEach(() => {
  vi.resetModules();
  resetGlobalSingletons();
  for (const f of [getMetrics, peekMetrics, getServicesFresh, peekServices, evaluateAndDispatch]) f.mockClear();
  vi.doMock("@/app/lib/metrics",  () => ({ getMetrics, peekMetrics }));
  vi.doMock("@/app/lib/services", () => ({ getServicesFresh, peekServices }));
  vi.doMock("@/app/lib/alerts-dispatch", () => ({ evaluateAndDispatch, alertWritesSettled: async () => {} }));
});
afterEach(() => {
  delete process.env.COMEXE_COLLECTOR;
  vi.useRealTimers();
});

const load = () => import("@/app/lib/collector");
const T0 = 1_700_000_000_000;

describe("tick — idle (no SSE clients)", () => {
  it("polls both sources on the first tick and evaluates on the result", async () => {
    const c = await load();
    await c.tick(T0);
    expect(getMetrics).toHaveBeenCalledTimes(1);
    expect(getServicesFresh).toHaveBeenCalledTimes(1);
    expect(evaluateAndDispatch).toHaveBeenCalledWith({ metrics: { cpu: 1 }, services: [] });
  });

  it("polls metrics every 30s and services every 60s, peeking otherwise", async () => {
    const c = await load();
    await c.tick(T0);                 // both
    await c.tick(T0 + 10_000);        // neither due → no-op
    await c.tick(T0 + 30_000);        // metrics only
    await c.tick(T0 + 60_000);        // both

    expect(getMetrics).toHaveBeenCalledTimes(3);
    expect(getServicesFresh).toHaveBeenCalledTimes(2);
    expect(peekServices).toHaveBeenCalledTimes(1);  // on the metrics-only tick
    expect(evaluateAndDispatch).toHaveBeenCalledTimes(3);
  });
});

describe("tick — active (SSE clients connected)", () => {
  it("makes no upstream calls, only evaluates on peeked data", async () => {
    const c = await load();
    c.streamClientConnected();
    await c.tick(T0);
    await c.tick(T0 + 10_000);

    expect(getMetrics).not.toHaveBeenCalled();
    expect(getServicesFresh).not.toHaveBeenCalled();
    expect(evaluateAndDispatch).toHaveBeenCalledTimes(2);
    expect(evaluateAndDispatch).toHaveBeenCalledWith({ metrics: { cpu: 2 }, services: [] });
  });

  it("returns to idle polling once the last client disconnects", async () => {
    const c = await load();
    c.streamClientConnected();
    c.streamClientConnected();
    c.streamClientDisconnected();
    c.streamClientDisconnected();
    c.streamClientDisconnected();   // extra disconnect must not go negative
    expect(c.collectorStatus().clients).toBe(0);

    await c.tick(T0);
    expect(getMetrics).toHaveBeenCalledTimes(1);
  });
});

describe("alert fan-out and status", () => {
  it("emits fires on the shared emitter", async () => {
    const fires = [{ key: "cpu", ts: T0, level: "critical", source: "metric", msg: "CPU 99%" }];
    evaluateAndDispatch.mockResolvedValueOnce({ fires, quiet: false });
    const c = await load();
    const onAlert = vi.fn();
    c.collectorEvents.on("alert", onAlert);

    await c.tick(T0);
    expect(onAlert).toHaveBeenCalledWith(fires);
  });

  it("records tick times and errors without throwing", async () => {
    evaluateAndDispatch.mockRejectedValueOnce(new Error("disk full"));
    const c = await load();
    await c.tick(T0);
    const s = c.collectorStatus();
    expect(s.lastError).toBe("disk full");
    expect(s.firstTickAt).not.toBeNull();
  });
});

describe("startCollector", () => {
  it("does nothing when COMEXE_COLLECTOR=0", async () => {
    process.env.COMEXE_COLLECTOR = "0";
    vi.useFakeTimers();
    const c = await load();
    c.startCollector();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getMetrics).not.toHaveBeenCalled();
    expect(c.collectorStatus().running).toBe(false);
  });

  it("starts one loop no matter how often it's called", async () => {
    vi.useFakeTimers({ now: T0 });
    const c = await load();
    c.startCollector();
    c.startCollector();
    // A second module instance (as instrumentation.ts gets) shares the state.
    vi.resetModules();
    (await load()).startCollector();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(getMetrics).toHaveBeenCalledTimes(1);
    await c.stopCollector();
  });

  it("stopCollector emits shutdown so SSE streams can close", async () => {
    const c = await load();
    const onShutdown = vi.fn();
    c.collectorEvents.on("shutdown", onShutdown);
    await c.stopCollector();
    await c.stopCollector();
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });
});
