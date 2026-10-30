import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetGlobalSingletons } from "./helpers/singletons";

// lib/metrics.ts used to be /api/metrics' ~30 queries destructured positionally
// out of one Promise.all — insert a query anywhere but the end and every later
// field silently took its neighbour's value. They're a named object now; these
// tests pin each field to the query that must feed it, plus the transforms
// (ZFS pool aggregation, unit normalisation) that are easy to get wrong.

type Sample = { metric: Record<string, string>; value: number };

const scalars: Record<string, number | null> = {};
const vectors: Record<string, Sample[]> = {};
const appendHistory = vi.fn(async () => {});

const CFG = {
  prometheusUrl: "http://prom:9090",
  fsPathPrefix:  "/mnt/Pool/Media/",
  poolPath:      "/mnt/Pool",
  netExclude:    "lo|veth.*",
};

beforeEach(() => {
  vi.resetModules();
  resetGlobalSingletons();
  for (const k of Object.keys(scalars)) delete scalars[k];
  for (const k of Object.keys(vectors)) delete vectors[k];
  appendHistory.mockClear();

  vi.doMock("@/app/lib/server-config", () => ({ loadConfig: async () => CFG }));
  vi.doMock("@/app/lib/history", () => ({ appendHistory }));
  vi.doMock("@/app/lib/prometheus", async () => {
    const actual = await vi.importActual<typeof import("@/app/lib/prometheus")>("@/app/lib/prometheus");
    return {
      ...actual,
      promScalar: async (_base: string, q: string) => scalars[q] ?? null,
      promVector: async (_base: string, q: string) => vectors[q] ?? [],
    };
  });
});

async function load() {
  return import("@/app/lib/metrics");
}

describe("getMetrics — query-to-field mapping", () => {
  it("derives cpu from the idle query, and memory from its three queries", async () => {
    scalars[`avg(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100`] = 70;
    scalars["node_memory_MemTotal_bytes"] = 1000;
    scalars["node_memory_MemAvailable_bytes"] = 400;
    scalars["node_memory_SReclaimable_bytes"] = 50;
    scalars["time() - node_boot_time_seconds"] = 12345;

    const m = await (await load()).getMetrics();
    expect(m.cpu).toBe(30);
    expect(m.memory).toEqual({ total: 1000, used: 600, available: 400, sReclaimable: 50 });
    expect(m.uptime).toBe(12345);
  });

  it("turns per-thread idle rates into busy % in cpu-number order", async () => {
    // "cpu" is a string label: sorted as text, cpu10 would land before cpu2.
    vectors[`rate(node_cpu_seconds_total{mode="idle"}[2m])`] = [
      { metric: { cpu: "10" }, value: 0.25 },
      { metric: { cpu: "2" },  value: 0.9 },
      { metric: { cpu: "0" },  value: 1.02 },   // rate jitter can top 1
      { metric: { cpu: "1" },  value: NaN },
    ];
    const m = await (await load()).getMetrics();
    expect(m.cpuThreads).toEqual([0, 10, 75]);
  });

  it("records the same ZFS-aware memory figure in history as the Memory card shows", async () => {
    scalars["node_memory_MemTotal_bytes"] = 1000;
    scalars["node_memory_MemAvailable_bytes"] = 400;
    scalars["node_memory_SReclaimable_bytes"] = 50;
    await (await load()).getMetrics();
    expect(appendHistory).toHaveBeenCalledWith(expect.objectContaining({ mem: 55 })); // (1000 − 400 − 50) / 1000
  });

  it("maps the GPU queries to the right fields, including ratio → percent", async () => {
    scalars["nvidia_smi_utilization_gpu_ratio"] = 0.42;
    scalars["nvidia_smi_temperature_gpu"] = 61;
    scalars["nvidia_smi_power_draw_watts"] = 120;
    scalars["nvidia_smi_power_limit_watts"] = 250;
    scalars["nvidia_smi_fan_speed_ratio"] = 0.35;
    scalars["nvidia_smi_utilization_encoder_ratio"] = 0.1;
    scalars["nvidia_smi_utilization_decoder_ratio"] = 0.2;
    vectors["nvidia_smi_gpu_info"] = [{ metric: { name: "RTX 3060" }, value: 1 }];

    const { gpu } = await (await load()).getMetrics();
    expect(gpu).toMatchObject({
      name: "RTX 3060", utilization: 42, temperature: 61,
      powerDraw: 120, powerLimit: 250, fanSpeed: 35, encUtil: 10, decUtil: 20,
    });
  });

  it("uses the configured network exclude and sums interfaces", async () => {
    vectors[`rate(node_network_receive_bytes_total{device!~"lo|veth.*"}[2m])`] = [
      { metric: { device: "enp4s0" }, value: 900 },
      { metric: { device: "wlan0" },  value: 100 },
    ];
    vectors[`rate(node_network_transmit_bytes_total{device!~"lo|veth.*"}[2m])`] = [
      { metric: { device: "enp4s0" }, value: 50 },
    ];

    const { network } = await (await load()).getMetrics();
    expect(network).toMatchObject({ rxBytesPerSec: 1000, txBytesPerSec: 50, interfaceName: "enp4s0" });
  });

  it("flags scrapeDegraded only when some targets are down", async () => {
    vectors["up"] = [
      { metric: { job: "node", instance: "a" }, value: 1 },
      { metric: { job: "nvidia", instance: "b" }, value: 0 },
    ];
    const m = await (await load()).getMetrics();
    expect(m.scrapeDegraded).toBe(true);
    expect(m.scrapeTargets).toEqual([
      { job: "node", instance: "a", up: true },
      { job: "nvidia", instance: "b", up: false },
    ]);
  });
});

describe("getMetrics — filesystems and the ZFS pool", () => {
  const FS = `fstype!~"tmpfs|devtmpfs|overlay|squashfs|ramfs"`;

  it("shows only mounts under fsPathPrefix, and sums real usage across pool datasets", async () => {
    // Every ZFS dataset reports the pool's shared free space (300) as "avail".
    vectors[`node_filesystem_size_bytes{${FS}}`] = [
      { metric: { mountpoint: "/mnt/Pool" },             value: 310 },  // root holds 10
      { metric: { mountpoint: "/mnt/Pool/Media/Movies" }, value: 800 },  // holds 500
      { metric: { mountpoint: "/mnt/Pool/Media/TV" },     value: 500 },  // holds 200
      { metric: { mountpoint: "/boot" },                  value: 100 },
    ];
    vectors[`node_filesystem_avail_bytes{${FS}}`] = [
      { metric: { mountpoint: "/mnt/Pool" },             value: 300 },
      { metric: { mountpoint: "/mnt/Pool/Media/Movies" }, value: 300 },
      { metric: { mountpoint: "/mnt/Pool/Media/TV" },     value: 300 },
      { metric: { mountpoint: "/boot" },                  value: 40 },
    ];

    const m = await (await load()).getMetrics();
    expect(m.disks.map(d => d.mountpoint)).toEqual(["/mnt/Pool/Media/Movies", "/mnt/Pool/Media/TV"]);
    // 10 + 500 + 200 used, plus the shared 300 free — not the root's 10 of 310.
    expect(m.pool).toEqual({ used: 710, avail: 300, total: 1010 });
  });

  it("reports a null pool when no mount matches poolPath", async () => {
    const m = await (await load()).getMetrics();
    expect(m.pool).toEqual({ used: null, avail: null, total: null });
  });
});

describe("getMetrics — caching and history", () => {
  it("serves repeat calls from cache and appends one history point per real fetch", async () => {
    scalars[`avg(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100`] = 75;
    const { getMetrics, peekMetrics } = await load();

    expect(peekMetrics()).toBeNull();
    const a = await getMetrics();
    const b = await getMetrics();
    expect(b).toBe(a);
    expect(peekMetrics()).toBe(a);
    expect(appendHistory).toHaveBeenCalledTimes(1);
    expect(appendHistory).toHaveBeenCalledWith(expect.objectContaining({ cpu: 25 }));
  });

  it("dedupes concurrent cache misses into one fetch", async () => {
    const { getMetrics } = await load();
    const [a, b] = await Promise.all([getMetrics(), getMetrics()]);
    expect(a).toBe(b);
    expect(appendHistory).toHaveBeenCalledTimes(1);
  });
});

describe("unit normalisation", () => {
  it("toGhz handles Hz, kHz, MHz and GHz inputs", async () => {
    const { toGhz } = await load();
    expect(toGhz(3_600_000_000)).toBe(3.6);
    expect(toGhz(3_600_000)).toBe(3.6);
    expect(toGhz(3600)).toBe(3.6);
    expect(toGhz(3.6)).toBe(3.6);
    expect(toGhz(null)).toBeNull();
  });

  it("toMhz converts Hz, keeps MHz, and rejects implausibly small values", async () => {
    const { toMhz } = await load();
    expect(toMhz(1_200_000_000)).toBe(1200);
    expect(toMhz(1200)).toBe(1200);
    expect(toMhz(5)).toBeNull();
    expect(toMhz(null)).toBeNull();
  });
});
