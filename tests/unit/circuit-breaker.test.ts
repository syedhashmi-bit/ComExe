import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkCircuit, recordSuccess, recordFailure, snapshot, resetCircuits, originOf,
  CircuitOpenError,
} from "@/app/lib/circuit-breaker";

const ORIGIN = "http://192.168.88.196:30025";

function failTimes(n: number, origin = ORIGIN) {
  for (let i = 0; i < n; i++) recordFailure(origin, new Error("ECONNREFUSED"));
}

describe("circuit breaker", () => {
  beforeEach(() => {
    resetCircuits();
    vi.useRealTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("reduces a bare URL to its origin", () => {
    expect(originOf("http://host:9090/api/v1/query?query=up")).toBe("http://host:9090");
    expect(originOf("not a url")).toBe("not a url");
  });

  it("stays closed while calls succeed", () => {
    for (let i = 0; i < 20; i++) recordSuccess(ORIGIN);
    expect(checkCircuit(ORIGIN)).toBeNull();
    expect(snapshot()[0].state).toBe("closed");
  });

  it("tolerates failures below the threshold", () => {
    failTimes(4);
    expect(checkCircuit(ORIGIN)).toBeNull();
    expect(snapshot()[0].state).toBe("closed");
  });

  it("opens after 5 consecutive failures and stops issuing calls", () => {
    failTimes(5);
    const blocked = checkCircuit(ORIGIN);
    expect(blocked).toBeInstanceOf(CircuitOpenError);
    expect(snapshot()[0].state).toBe("open");
  });

  it("resets the failure streak on any success", () => {
    failTimes(4);
    recordSuccess(ORIGIN);
    failTimes(4);
    // 8 total failures but never 5 in a row — must stay closed.
    expect(checkCircuit(ORIGIN)).toBeNull();
    expect(snapshot()[0].state).toBe("closed");
  });

  it("allows a single probe after the cooldown, and closes on success", () => {
    vi.useFakeTimers();
    failTimes(5);
    expect(checkCircuit(ORIGIN)).toBeInstanceOf(CircuitOpenError);

    vi.advanceTimersByTime(31_000); // past the 30s base cooldown
    expect(checkCircuit(ORIGIN)).toBeNull();       // probe allowed
    expect(snapshot()[0].state).toBe("half-open");

    recordSuccess(ORIGIN);
    expect(snapshot()[0].state).toBe("closed");
    expect(snapshot()[0].consecutiveFailures).toBe(0);
  });

  it("re-opens with a longer cooldown when the probe fails", () => {
    vi.useFakeTimers();
    failTimes(5);
    vi.advanceTimersByTime(31_000);
    checkCircuit(ORIGIN);                    // → half-open
    recordFailure(ORIGIN, new Error("still down"));
    expect(snapshot()[0].state).toBe("open");

    // Second cooldown is 60s, so 31s must NOT be enough this time.
    vi.advanceTimersByTime(31_000);
    expect(checkCircuit(ORIGIN)).toBeInstanceOf(CircuitOpenError);
    vi.advanceTimersByTime(30_000);
    expect(checkCircuit(ORIGIN)).toBeNull();
  });

  it("tracks origins independently", () => {
    const other = "http://192.168.88.196:30027";
    failTimes(5, ORIGIN);
    recordSuccess(other);

    expect(checkCircuit(ORIGIN)).toBeInstanceOf(CircuitOpenError);
    expect(checkCircuit(other)).toBeNull();
    expect(snapshot()).toHaveLength(2);
  });

  it("reports diagnostics for the UI", () => {
    recordSuccess(ORIGIN);
    recordFailure(ORIGIN, new Error("boom"));
    const [health] = snapshot();
    expect(health.origin).toBe(ORIGIN);
    expect(health.totalCalls).toBe(2);
    expect(health.totalFailures).toBe(1);
    expect(health.lastError).toBe("boom");
    expect(health.lastSuccessTs).toBeTypeOf("number");
  });
});
