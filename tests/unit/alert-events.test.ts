import { describe, it, expect } from "vitest";
import {
  candidateFires, evaluateAlerts, inQuietHours, buildWebhookPayload,
} from "@/app/lib/alert-events";
import type { Metrics, ServiceResult } from "@/app/lib/types";

// 137 lines of pure threshold/throttle logic that decides what gets dispatched
// to a webhook, and it had no tests. Pure and dependency-free, so it needs no
// harness — this was the cheapest real coverage available in the repo.

function metrics(over: Partial<Metrics> = {}): Metrics {
  return {
    cpu: 10,
    memory: { total: 100, used: null, available: 90, sReclaimable: 0 },
    uptime: 1000,
    disks: [],
    network: { rxBytesPerSec: 0, txBytesPerSec: 0, rxBytesTotal: 0, txBytesTotal: 0 },
    gpu: {
      name: null, utilization: null, memUsed: null, memTotal: null,
      temperature: null, powerDraw: null, powerLimit: null,
      coreClock: null, memClock: null, fanSpeed: null, encUtil: null, decUtil: null,
    },
    timestamp: 0,
    ...over,
  };
}

const svc = (over: Partial<ServiceResult> = {}): ServiceResult =>
  ({ name: "radarr", up: true, lines: [], ...over });

const NOW = 1_700_000_000_000;

describe("candidateFires — metric thresholds", () => {
  // These must track app/lib/alerts.ts. README once documented CPU as
  // warn >70 / crit >90 when the code used 80/95; pinning them here means the
  // next drift shows up as a failing test rather than a wrong docs table.
  it("fires CPU warning above 80 and critical above 95", () => {
    expect(candidateFires(metrics({ cpu: 80 }), null, NOW)).toEqual([]);
    expect(candidateFires(metrics({ cpu: 81 }), null, NOW)[0]).toMatchObject({ level: "warning", source: "metric" });
    expect(candidateFires(metrics({ cpu: 96 }), null, NOW)[0]).toMatchObject({ level: "critical" });
  });

  it("uses ZFS-aware memory accounting, not raw available", () => {
    // total 100, available 2, sReclaimable 10 => real used = 88% -> no alert,
    // even though naive (total-available) would read 98% and fire critical.
    const arcHeavy = metrics({ memory: { total: 100, used: null, available: 2, sReclaimable: 10 } });
    expect(candidateFires(arcHeavy, null, NOW)).toEqual([]);

    // Same shape but the ARC isn't reclaimable — genuinely 98% used.
    const real = metrics({ memory: { total: 100, used: null, available: 2, sReclaimable: 0 } });
    expect(candidateFires(real, null, NOW)[0]).toMatchObject({ level: "critical" });
  });

  it("fires per-disk with the mountpoint in the key", () => {
    const m = metrics({ disks: [
      { mountpoint: "/mnt/Pool/Media/TV", device: "/dev/sda", fstype: "zfs", total: 100, avail: 4, used: 96, usedPct: 96 },
      { mountpoint: "/mnt/Pool/Media/Movies", device: "/dev/sdb", fstype: "zfs", total: 100, avail: 50, used: 50, usedPct: 50 },
    ] });
    const fires = candidateFires(m, null, NOW);
    expect(fires).toHaveLength(1);
    expect(fires[0].key).toContain("/mnt/Pool/Media/TV");
    expect(fires[0].level).toBe("critical");
  });

  it("ignores null metrics rather than treating them as zero", () => {
    expect(candidateFires(metrics({ cpu: null }), null, NOW)).toEqual([]);
    expect(candidateFires(null, null, NOW)).toEqual([]);
  });
});

describe("candidateFires — services", () => {
  // The README claimed "service down count >= 1 warning, >= 3 critical".
  // There is no count threshold: one unreachable service is critical.
  it("treats a single unreachable service as critical", () => {
    const fires = candidateFires(null, [svc({ up: false })], NOW);
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ level: "critical", source: "service" });
  });

  it("does not alert on services that were never configured", () => {
    expect(candidateFires(null, [svc({ up: false, configured: false })], NOW)).toEqual([]);
  });

  it("prefers down over error over warning for the same service", () => {
    const down = candidateFires(null, [svc({ up: false, health: { warning: 5, error: 5 } })], NOW);
    expect(down).toHaveLength(1);
    expect(down[0].key).toContain(":down");

    const err = candidateFires(null, [svc({ up: true, health: { warning: 5, error: 2 } })], NOW);
    expect(err[0].key).toContain(":error");
    expect(err[0].level).toBe("critical");

    const warn = candidateFires(null, [svc({ up: true, health: { warning: 1, error: 0 } })], NOW);
    expect(warn[0].key).toContain(":warn");
    expect(warn[0].level).toBe("warning");
  });
});

describe("evaluateAlerts — throttling", () => {
  it("suppresses a repeat fire inside the throttle window", () => {
    const input = { metrics: metrics({ cpu: 99 }), services: null, throttleMs: 60_000 };
    const first = evaluateAlerts({ ...input, lastFire: {}, now: NOW });
    expect(first.fires).toHaveLength(1);

    const again = evaluateAlerts({ ...input, lastFire: first.newLastFire, now: NOW + 59_000 });
    expect(again.fires).toEqual([]);
    // State must survive the suppressed cycle, or the throttle resets forever.
    expect(again.newLastFire).toEqual(first.newLastFire);
  });

  it("fires again once the window has passed", () => {
    const input = { metrics: metrics({ cpu: 99 }), services: null, throttleMs: 60_000 };
    const first = evaluateAlerts({ ...input, lastFire: {}, now: NOW });
    const later = evaluateAlerts({ ...input, lastFire: first.newLastFire, now: NOW + 60_001 });
    expect(later.fires).toHaveLength(1);
  });

  it("throttles per key, so an unrelated alert still gets through", () => {
    const cpuOnly = evaluateAlerts({ metrics: metrics({ cpu: 99 }), services: null, lastFire: {}, throttleMs: 60_000, now: NOW });
    const withDisk = evaluateAlerts({
      metrics: metrics({ cpu: 99, disks: [{ mountpoint: "/x", device: "d", fstype: "zfs", total: 100, avail: 1, used: 99, usedPct: 99 }] }),
      services: null,
      lastFire: cpuOnly.newLastFire,
      throttleMs: 60_000,
      now: NOW + 1_000,
    });
    expect(withDisk.fires).toHaveLength(1);
    expect(withDisk.fires[0].key).toContain("/x");
  });
});

describe("inQuietHours", () => {
  const at = (h: number) => new Date(2026, 0, 1, h, 30);

  it("handles a same-day window", () => {
    expect(inQuietHours(at(10), 9, 17)).toBe(true);
    expect(inQuietHours(at(8),  9, 17)).toBe(false);
    expect(inQuietHours(at(17), 9, 17)).toBe(false); // end is exclusive
  });

  // The case most likely to be wrong: a window that spans midnight.
  it("handles a window that wraps midnight", () => {
    expect(inQuietHours(at(23), 22, 7)).toBe(true);
    expect(inQuietHours(at(3),  22, 7)).toBe(true);
    expect(inQuietHours(at(12), 22, 7)).toBe(false);
  });

  it("treats an empty window (start === end) as never quiet", () => {
    expect(inQuietHours(at(9), 9, 9)).toBe(false);
  });
});

describe("buildWebhookPayload", () => {
  const fires = [{ key: "cpu>95", ts: NOW, level: "critical" as const, source: "metric" as const, msg: "CPU at 99%" }];

  it("produces a distinct shape per destination", () => {
    expect(buildWebhookPayload("discord", fires, "nas")).toHaveProperty("embeds");
    expect(buildWebhookPayload("slack", fires, "nas")).toHaveProperty("text");
    expect(JSON.stringify(buildWebhookPayload("generic", fires, "nas"))).toContain("cpu>95");
  });

  it("includes the alert message in every format", () => {
    for (const fmt of ["generic", "discord", "slack", "ntfy"] as const) {
      expect(JSON.stringify(buildWebhookPayload(fmt, fires, "nas"))).toContain("CPU at 99%");
    }
  });
});
