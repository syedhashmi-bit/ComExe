import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTTLCache, createKeyedTTLCache } from "@/app/lib/cache";

describe("createTTLCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns null before anything is set", () => {
    expect(createTTLCache<number>(1000).get()).toBeNull();
  });

  it("returns the value while fresh", () => {
    const c = createTTLCache<number>(1000);
    c.set(42);
    expect(c.get()).toBe(42);
    vi.advanceTimersByTime(999);
    expect(c.get()).toBe(42);
  });

  it("expires exactly at the TTL boundary", () => {
    const c = createTTLCache<number>(1000);
    c.set(42);
    vi.advanceTimersByTime(1000);
    expect(c.get()).toBeNull();
  });

  it("stores falsy values without treating them as a miss", () => {
    const c = createTTLCache<number>(1000);
    c.set(0);
    expect(c.get()).toBe(0);
  });

  it("invalidate() drops the cached value", () => {
    const c = createTTLCache<string>(1000);
    c.set("x");
    c.invalidate();
    expect(c.get()).toBeNull();
  });
});

describe("createKeyedTTLCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stores and retrieves per key", () => {
    const c = createKeyedTTLCache<string>(1000);
    c.set("a", "x");
    c.set("b", "y");
    expect(c.get("a")).toBe("x");
    expect(c.get("b")).toBe("y");
    expect(c.get("missing")).toBeNull();
  });

  it("expires per key independently", () => {
    const c = createKeyedTTLCache<string>(1000);
    c.set("a", "x");
    vi.advanceTimersByTime(500);
    c.set("b", "y");
    vi.advanceTimersByTime(500); // a is now 1000ms old, b is 500ms old
    expect(c.get("a")).toBeNull();
    expect(c.get("b")).toBe("y");
  });

  it("evicts the oldest entry beyond maxEntries", () => {
    const c = createKeyedTTLCache<number>(10_000, 2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // exceeds cap of 2 → "a" (oldest) evicted
    expect(c.get("a")).toBeNull();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });

  it("invalidate(key) drops one; invalidate() clears all", () => {
    const c = createKeyedTTLCache<number>(10_000, 10);
    c.set("a", 1);
    c.set("b", 2);
    c.invalidate("a");
    expect(c.get("a")).toBeNull();
    expect(c.get("b")).toBe(2);
    c.invalidate();
    expect(c.get("b")).toBeNull();
  });
});
