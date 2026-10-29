import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetGlobalSingletons } from "./helpers/singletons";

// /api/storage's forecast: the maths (days until 85% / full), the regex it
// builds from POOL_PATH, and which query feeds which field.

const DAY = 86_400_000;
const scalars: Record<string, number | null> = {};
const vectors: Record<string, { metric: Record<string, string>; value: number }[]> = {};
let range: { metric: Record<string, string>; values: { ts: number; value: number }[] }[] = [];

beforeEach(() => {
  vi.resetModules();
  resetGlobalSingletons();
  for (const k of Object.keys(scalars)) delete scalars[k];
  for (const k of Object.keys(vectors)) delete vectors[k];
  range = [];
  vi.doMock("@/app/lib/server-config", () => ({
    loadConfig: async () => ({ prometheusUrl: "http://prom:9090", poolPath: "/mnt/Pool", fsPathPrefix: "/mnt/Pool/Media/" }),
  }));
  vi.doMock("@/app/lib/metrics", () => ({
    peekMetrics: () => ({ pool: { total: 18e12, used: 9e12, avail: 9e12 } }),
    getMetrics: async () => null,
  }));
  vi.doMock("@/app/lib/prometheus", async () => {
    const actual = await vi.importActual<typeof import("@/app/lib/prometheus")>("@/app/lib/prometheus");
    return {
      ...actual,
      promScalar: async (_b: string, q: string) => scalars[q] ?? null,
      promVector: async (_b: string, q: string) => vectors[q] ?? [],
      promRange:  async () => range,
    };
  });
});

describe("daysUntil", () => {
  it("counts the days to a threshold at a steady rate", async () => {
    const { daysUntil } = await import("@/app/lib/storage");
    // 10 TB pool, 5 TB used, 8.5 TB is 85%: 3.5 TB to go at 50 GB/day.
    expect(daysUntil(5e12, 10e12, 50e9, 85)).toBeCloseTo(70);
    expect(daysUntil(9e12, 10e12, 50e9, 85)).toBe(0);      // already there
    expect(daysUntil(5e12, 10e12, 10e6, 85)).toBeNull();   // too slow to call
    expect(daysUntil(5e12, 10e12, -5e9, 85)).toBeNull();   // shrinking
    expect(daysUntil(5e12, 10e12, null, 85)).toBeNull();
  });
});

describe("subtreeRegex", () => {
  it("matches the path and everything under it, escaped for PromQL", async () => {
    const { subtreeRegex } = await import("@/app/lib/storage");
    expect(subtreeRegex("/mnt/Pool")).toBe("/mnt/Pool(/.*)?");
    expect(subtreeRegex("/mnt/Pool/")).toBe("/mnt/Pool(/.*)?");
    expect(subtreeRegex("/mnt/my.pool")).toBe("/mnt/my\\\\.pool(/.*)?");
  });
});

describe("getStorageInsight", () => {
  it("maps growth, history, datasets, pool state and ZFS cache", async () => {
    const poolAvail = 'max(node_filesystem_avail_bytes{mountpoint=~"/mnt/Pool(/.*)?"})';
    scalars[`-deriv(${poolAvail}[7d:1h])`] = 50e9 / 86_400;   // 50 GB a day
    scalars["rate(node_zfs_arc_hits[1h])"] = 97;
    scalars["rate(node_zfs_arc_misses[1h])"] = 3;
    vectors[`deriv((node_filesystem_size_bytes{fstype!~"tmpfs|devtmpfs|overlay|squashfs|ramfs"} - node_filesystem_avail_bytes{fstype!~"tmpfs|devtmpfs|overlay|squashfs|ramfs"})[7d:1h])`] = [
      { metric: { mountpoint: "/mnt/Pool/Media/Movies" }, value: 10e9 / 86_400 },
      { metric: { mountpoint: "/mnt/Pool/Media/TV" },     value: 30e9 / 86_400 },
      { metric: { mountpoint: "/var/log" },               value: 1e9 / 86_400 },  // not a media dataset
    ];
    vectors["node_zfs_zpool_state == 1"] = [
      { metric: { zpool: "boot-pool", state: "online" }, value: 1 },
      { metric: { zpool: "Pool", state: "degraded" }, value: 1 },
    ];
    range = [{ metric: {}, values: [{ ts: 1, value: 10e12 }, { ts: 2, value: 9e12 }] }];

    const { getStorageInsight } = await import("@/app/lib/storage");
    const s = await getStorageInsight();

    expect(s.poolPct).toBe(50);
    expect(s.growthPerDay).toBeCloseTo(50e9);
    expect(s.daysToWarn).toBeCloseTo((18e12 * 0.85 - 9e12) / 50e9);
    expect(s.daysToFull).toBeCloseTo(9e12 / 50e9);
    expect(s.history.map(p => p.pct)).toEqual([44.4, 50]);
    expect(s.datasets.map(d => d.mountpoint)).toEqual(["/mnt/Pool/Media/TV", "/mnt/Pool/Media/Movies"]);
    expect(s.poolState).toBe("degraded");     // the pool POOL_PATH names, not boot-pool
    expect(s.arcHitPct).toBe(97);
  });

  it("returns nulls rather than throwing when Prometheus has nothing", async () => {
    const { getStorageInsight } = await import("@/app/lib/storage");
    const s = await getStorageInsight();
    expect(s).toMatchObject({ growthPerDay: null, daysToWarn: null, history: [], datasets: [], poolState: null, arcHitPct: null });
  });
});
