import { describe, it, expect, beforeEach, vi } from "vitest";

// /api/smart reads the smartmon textfile collector. It used to query the
// normalised `_value` series (0–253 health scores) instead of `_raw_value`,
// so temperatures and sector counts were nonsense, and it looked for the
// device model in a smart_id-filtered series that doesn't exist.

type Row = { metric: Record<string, string>; value: number };
const queries: string[] = [];

function series(byQuery: Record<string, Row[]>) {
  vi.doMock("@/app/lib/prometheus", () => ({
    promVector: async (_base: string, q: string) => { queries.push(q); return byQuery[q] ?? []; },
  }));
}

beforeEach(() => {
  vi.resetModules();
  queries.length = 0;
  vi.doMock("@/app/lib/server-config", () => ({ loadConfig: async () => ({ prometheusUrl: "http://prom:9090" }) }));
});

const sda = { disk: "/dev/sda", type: "sat" };

describe("/api/smart", () => {
  it("reports raw readings and the model/serial labels from smartmon_device_info", async () => {
    series({
      smartmon_temperature_celsius_raw_value:     [{ metric: { ...sda, smart_id: "194" }, value: 36 }],
      smartmon_power_on_hours_raw_value:         [{ metric: { ...sda, smart_id: "9" }, value: 21_934 }],
      smartmon_reallocated_sector_ct_raw_value:  [{ metric: { ...sda, smart_id: "5" }, value: 0 }],
      smartmon_current_pending_sector_raw_value: [{ metric: { ...sda, smart_id: "197" }, value: 0 }],
      smartmon_offline_uncorrectable_raw_value:  [{ metric: { ...sda, smart_id: "198" }, value: 0 }],
      smartmon_device_info: [{ metric: { ...sda, device_model: "WDC WD40EFRX-68N32N0", serial_number: "WD-ABC123" }, value: 1 }],
    });
    const { GET } = await import("@/app/api/smart/route");
    const { disks } = await (await GET()).json();

    expect(queries.some(q => q.includes("_raw_value"))).toBe(true);
    expect(queries.some(q => /_value$/.test(q) && !q.includes("_raw_value"))).toBe(false);
    expect(disks).toEqual([{
      device: "/dev/sda", model: "WDC WD40EFRX-68N32N0", serial: "WD-ABC123",
      temperature: 36, powerOnHours: 21_934, reallocatedSectors: 0, pendingSectors: 0, uncorrectableSectors: 0,
      healthy: true,
    }]);
  });

  it("flags a disk with reallocated sectors when there's no smart_healthy series", async () => {
    series({
      smartmon_temperature_celsius_raw_value:    [{ metric: sda, value: 40 }],
      smartmon_reallocated_sector_ct_raw_value: [{ metric: sda, value: 8 }],
    });
    const { GET } = await import("@/app/api/smart/route");
    const { disks } = await (await GET()).json();
    expect(disks[0]).toMatchObject({ device: "/dev/sda", reallocatedSectors: 8, healthy: false, model: "Unknown" });
  });

  it("trusts smartmon_device_smart_healthy when present", async () => {
    series({
      smartmon_temperature_celsius_raw_value: [{ metric: sda, value: 40 }],
      smartmon_device_smart_healthy:          [{ metric: sda, value: 1 }],
    });
    const { GET } = await import("@/app/api/smart/route");
    const { disks } = await (await GET()).json();
    expect(disks[0].healthy).toBe(true);
  });
});
