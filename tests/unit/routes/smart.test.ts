import { describe, it, expect, beforeEach, vi } from "vitest";

// /api/smart reads the smartmon textfile collector. It used to query the
// normalised `_value` series (0–253 health scores) instead of `_raw_value`,
// so temperatures and sector counts were nonsense, and it looked for the
// device model in a smart_id-filtered series that doesn't exist.

type Row = { metric: Record<string, string>; value: number };
type Series = { metric: Record<string, string>; values: { ts: number; value: number }[] };
const queries: string[] = [];

function series(byQuery: Record<string, Row[]>, extra: { scalars?: Record<string, number>; ranges?: Record<string, Series[]> } = {}) {
  vi.doMock("@/app/lib/prometheus", () => ({
    promVector: async (_base: string, q: string) => { queries.push(q); return byQuery[q] ?? []; },
    promScalar: async (_base: string, q: string) => extra.scalars?.[q] ?? null,
    promRange:  async (_base: string, q: string) => extra.ranges?.[q] ?? [],
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
      device: "/dev/sda", kind: "sata", model: "WDC WD40EFRX-68N32N0", serial: "WD-ABC123",
      temperature: 36, powerOnHours: 21_934, reallocatedSectors: 0, pendingSectors: 0, uncorrectableSectors: 0,
      healthy: true, history: [],
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

  it("fills an NVMe drive's temperature and model from node_exporter", async () => {
    // smartmon.sh reports NVMe health and serial only, with an empty model.
    const nvme = { disk: "/dev/nvme0", type: "nvme" };
    series({
      smartmon_device_smart_healthy: [{ metric: nvme, value: 1 }],
      smartmon_device_info: [{ metric: { ...nvme, device_model: "", serial_number: "9WBO6" }, value: 1 }],
      'node_hwmon_temp_celsius{chip=~"nvme_.+",sensor="temp1"}': [{ metric: { chip: "nvme_nvme0", sensor: "temp1" }, value: 32.85 }],
      node_nvme_info: [
        { metric: { device: "nvme0", model: "CUSU CV3500Q 512GB", serial: "9WBO6" }, value: 1 },
        { metric: { device: "nvme1", model: "Not in smartmon" }, value: 1 },
      ],
    });
    const { GET } = await import("@/app/api/smart/route");
    const { disks } = await (await GET()).json();
    expect(disks).toEqual([{
      device: "/dev/nvme0", kind: "nvme", model: "CUSU CV3500Q 512GB", serial: "9WBO6",
      temperature: 33, powerOnHours: null, reallocatedSectors: null, pendingSectors: null, uncorrectableSectors: null,
      healthy: true, history: [],
    }]);   // nvme1 isn't added on node_exporter's word alone
  });

  it("adds each drive's last 24 h of temperatures and when the script last ran", async () => {
    const nvme = { disk: "/dev/nvme0", type: "nvme" };
    const sdb = { disk: "/dev/sdb", type: "scsi" };
    const pts = (...v: number[]) => v.map((value, i) => ({ ts: i * 1_800_000, value }));
    series({
      smartmon_device_smart_healthy: [{ metric: nvme, value: 1 }, { metric: sdb, value: 1 }],
      smartmon_temperature_celsius_raw_value: [{ metric: sdb, value: 41 }],
    }, {
      scalars: { "max(smartmon_smartctl_run)": 1_793_405_153 },
      ranges: {
        smartmon_temperature_celsius_raw_value: [{ metric: sdb, values: pts(39, 40, 41) }],
        'node_hwmon_temp_celsius{chip=~"nvme_.+",sensor="temp1"}': [{ metric: { chip: "nvme_nvme0", sensor: "temp1" }, values: pts(30.85, 31.25) }],
      },
    });
    const { GET } = await import("@/app/api/smart/route");
    const body = await (await GET()).json();
    expect(body.readAt).toBe(1_793_405_153_000);
    expect(body.disks.map((d: { device: string; kind: string; history: number[] }) => [d.device, d.kind, d.history])).toEqual([
      ["/dev/nvme0", "nvme", [30.9, 31.3]],
      ["/dev/sdb", "sas", [39, 40, 41]],
    ]);
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

describe("/api/smart?device=", () => {
  const get = async (device: string) => {
    const { GET } = await import("@/app/api/smart/route");
    return GET(new Request(`http://localhost/api/smart?device=${encodeURIComponent(device)}`));
  };

  it("refuses anything but a plain device name, before any query", async () => {
    series({});
    for (const bad of ['/dev/sda"}', "/dev/../etc", "sda", "/dev/sd a", '/dev/sda",disk=~".*']) {
      expect((await get(bad)).status).toBe(400);
    }
    expect(queries).toEqual([]);
  });

  it("returns a week of temperatures and every SMART attribute, in attribute order", async () => {
    const sda = { disk: "/dev/sda", type: "sat" };
    series({
      '{__name__=~"smartmon_.+_raw_value",disk="/dev/sda"}': [
        { metric: { __name__: "smartmon_temperature_celsius_raw_value", ...sda, smart_id: "194" }, value: 42 },
        { metric: { __name__: "smartmon_reallocated_sector_ct_raw_value", ...sda, smart_id: "5" }, value: 0 },
      ],
      'smartmon_device_info{disk="/dev/sda"}': [{ metric: { ...sda, serial_number: "WD-X1", firmware_version: "82.00A82" }, value: 1 }],
    }, {
      ranges: { 'smartmon_temperature_celsius_raw_value{disk="/dev/sda"}': [{ metric: sda, values: [{ ts: 1, value: 41 }, { ts: 2, value: 42 }] }] },
    });
    const body = await (await get("/dev/sda")).json();
    expect(body).toEqual({
      device: "/dev/sda", firmware: "82.00A82", serial: "WD-X1",
      attributes: [{ id: 5, name: "reallocated_sector_ct", value: 0 }, { id: 194, name: "temperature_celsius", value: 42 }],
      history: [{ ts: 1, value: 41 }, { ts: 2, value: 42 }],
    });
  });

  it("falls back to the kernel sensor and node_nvme_info for an NVMe drive", async () => {
    series({
      'node_nvme_info{device="nvme0"}': [{ metric: { device: "nvme0", firmware_revision: "SN24737", serial: "9WBO6" }, value: 1 }],
    }, {
      ranges: { 'node_hwmon_temp_celsius{chip="nvme_nvme0",sensor="temp1"}': [{ metric: { chip: "nvme_nvme0" }, values: [{ ts: 1, value: 30.85 }] }] },
    });
    const body = await (await get("/dev/nvme0")).json();
    expect(body).toMatchObject({ attributes: [], firmware: "SN24737", serial: "9WBO6", history: [{ ts: 1, value: 30.9 }] });
  });
});
