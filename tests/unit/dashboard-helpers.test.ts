import { describe, it, expect } from "vitest";
import { threadColumns, busiestThreads } from "@/app/components/CpuThreads";
import { niceMax, spanLabel } from "@/app/components/NetworkChart";
import { sparkRange } from "@/app/components/primitives";
import { fmtMbps } from "@/app/components/NowPlaying";
import { fmtDays, forecastSentence } from "@/app/components/FilesystemsBody";
import { cellLevels, serviceUptime, fmtUptimePct } from "@/app/components/IncidentStrip";
import { fmtDuration } from "@/app/lib/formatters";
import { seedFromHistory, type SavedPoint } from "@/app/lib/history-seed";
import { statusIcon, statusTitle } from "@/app/hooks/useTabStatus";
import { summarize, transferred, trendPaths, type TrendPoint } from "@/app/components/TrendsCard";
import { tempLimits, scalePct, diskErrors, fmtAge, sortDisks, attrLabel } from "@/app/components/DiskHealthPanel";
import { friendlyDriveName } from "@/app/lib/drive-names";
import type { SmartDisk } from "@/app/lib/types";

// Small pure helpers behind the CPU thread grid, the network chart, the
// storage forecast and the incident strip.

describe("threadColumns", () => {
  it("keeps rows even and at most 16 wide", () => {
    expect(threadColumns(12)).toBe(12);
    expect(threadColumns(28)).toBe(14);
    expect(threadColumns(64)).toBe(16);
    expect(threadColumns(48)).toBe(16);
  });
});

describe("busiestThreads", () => {
  it("returns the top threads with their cpu numbers", () => {
    expect(busiestThreads([10, 93, 40, 88])).toEqual([{ cpu: 1, pct: 93 }, { cpu: 3, pct: 88 }, { cpu: 2, pct: 40 }]);
  });
});

describe("niceMax", () => {
  it("rounds a peak up to a readable axis maximum", () => {
    expect(niceMax(24.5e6)).toBe(30e6);
    expect(niceMax(3.2e6)).toBe(5e6);
    expect(niceMax(0)).toBe(1500);   // floor of 1 KiB, rounded up
  });
});

describe("forecast wording", () => {
  it("formats rough durations", () => {
    expect(fmtDays(1)).toBe("a day");
    expect(fmtDays(10)).toBe("10 days");
    expect(fmtDays(21)).toBe("3 weeks");
    expect(fmtDays(200)).toBe("7 months");
    expect(fmtDays(1241)).toBe("3.4 years");
  });

  it("says something true in each case", () => {
    expect(forecastSentence({ growthPerDay: null, daysToWarn: null, daysToFull: null })).toMatch(/Not enough history/);
    expect(forecastSentence({ growthPerDay: 1, daysToWarn: null, daysToFull: null })).toMatch(/flat/);
    expect(forecastSentence({ growthPerDay: 5e9, daysToWarn: 0, daysToFull: 40 })).toMatch(/Already past 85%.*6 weeks/);
    expect(forecastSentence({ growthPerDay: 5e9, daysToWarn: 21, daysToFull: 200 })).toBe(
      "At this rate the pool reaches 85% in about 3 weeks and fills in about 7 months.");
  });
});

describe("fmtDuration", () => {
  it("reads naturally at every scale", () => {
    expect(fmtDuration(20_000)).toBe("under a minute");
    expect(fmtDuration(12 * 60_000)).toBe("12 min");
    expect(fmtDuration(125 * 60_000)).toBe("2 h 5 min");
    expect(fmtDuration(120 * 60_000)).toBe("2 h");
    expect(fmtDuration((3 * 24 + 4) * 3_600_000)).toBe("3 d 4 h");
  });
});

describe("cellLevels", () => {
  it("marks each 15-minute cell with the worst incident touching it", () => {
    const now = 1_700_000_000_000, q = 15 * 60_000;
    const levels = cellLevels([
      { key: "cpu", level: "warning", title: "High CPU", start: now - 3 * q + 1, end: now - 2 * q - 1 },
      { key: "service:radarr:down", level: "critical", title: "Radarr unreachable", start: now - 30_000, end: null },
    ], now);
    expect(levels).toHaveLength(96);
    expect(levels.slice(-3)).toEqual(["warning", null, "critical"]);
    expect(levels.slice(0, 93).every(l => l === null)).toBe(true);
  });
});

describe("seedFromHistory", () => {
  const pt = (ts: number, over: Partial<SavedPoint> = {}): SavedPoint =>
    ({ ts, cpu: ts / 1000, gpu: null, net_rx: ts, net_tx: ts / 10, ...over });

  it("keeps the newest points before the cutoff, rx/tx/times aligned", () => {
    const s = seedFromHistory([pt(1000), pt(2000, { net_rx: null }), pt(3000), pt(4000), pt(5000)], 5000, 3);
    expect(s.cpu).toEqual([2, 3, 4]);          // 5000 is the live feed's; newest 3 before it
    expect(s.rx).toEqual([3000, 4000]);        // the point with no rx is dropped from all three
    expect(s.tx).toEqual([300, 400]);
    expect(s.times).toEqual([3000, 4000]);
    expect(s.gpu).toEqual([]);                 // no GPU, no GPU line
  });

  it("returns empty buffers for an empty history", () => {
    expect(seedFromHistory([], Date.now(), 60)).toEqual({ cpu: [], gpu: [], rx: [], tx: [], times: [] });
  });
});

describe("tab status", () => {
  it("titles the tab by how many things need attention", () => {
    expect(statusTitle(0)).toBe("ComExe");
    expect(statusTitle(1)).toBe("1 issue · ComExe");
    expect(statusTitle(3)).toBe("3 issues · ComExe");
  });

  it("draws the warning or critical dot into the icon", () => {
    expect(decodeURIComponent(statusIcon("critical"))).toContain('fill="#f85149"');
    expect(decodeURIComponent(statusIcon("warning"))).toContain('fill="#d29922"');
    expect(statusIcon("warning")).toMatch(/^data:image\/svg\+xml,/);
  });
});

describe("sparkRange", () => {
  it("fits series that never go near zero, and centres a flat one", () => {
    expect(sparkRange([10, 90], "pct")).toEqual([0, 100]);
    expect(sparkRange([2, 8], "max")).toEqual([0, 8]);
    const [lo, hi] = sparkRange([440, 450, 460], "fit");
    expect(lo).toBeLessThan(440);
    expect(hi).toBeGreaterThan(460);
    expect(hi).toBeLessThan(500);                    // not a 0-based scale
    const [flo, fhi] = sparkRange([45, 45, 45], "fit");
    expect((flo + fhi) / 2).toBeCloseTo(45);         // flat line sits mid-height
  });
});

describe("mirrored chart helpers", () => {
  it("labels the time span and respects a lower axis floor", () => {
    expect(spanLabel(10 * 60_000)).toBe("10 min ago");
    expect(spanLabel(6 * 3_600_000)).toBe("6 h ago");
    expect(spanLabel(4 * 86_400_000)).toBe("4 days ago");
    expect(niceMax(452, 10)).toBe(500);              // Mbps, not bytes
  });
});

describe("serviceUptime", () => {
  const now = 1_700_000_000_000, H = 3_600_000;
  const inc = (key: string, start: number, end: number | null, level: "warning" | "critical" = "critical") =>
    ({ key, level, title: key, start, end });

  it("marks down time red and health failures by level, and counts only down time", () => {
    const u = serviceUptime([
      inc("service:radarr:down", now - 10 * H, now - 10 * H + 12 * 60_000),
      inc("service:radarr:health", now - 2 * H, now - H, "warning"),
      inc("service:sonarr:down", now - 5 * H, null),
    ], "radarr", now, now - 7 * 24 * H);
    expect(u.cells).toHaveLength(48);
    expect(u.cells.filter(c => c === "critical")).toHaveLength(1);
    expect(u.cells.filter(c => c === "warning").length).toBeGreaterThan(0);
    expect(fmtUptimePct(u.pct!)).toBe("99.2%");      // 12 min of 24 h
  });

  it("doesn't claim a day of uptime the log never watched", () => {
    expect(serviceUptime([], "radarr", now, now - 20 * 60_000).pct).toBeNull();
    expect(fmtUptimePct(serviceUptime([], "radarr", now, now - 3 * H).pct!)).toBe("100%");
  });
});

describe("fmtMbps", () => {
  it("reads bitrates the way players show them", () => {
    expect(fmtMbps(8200)).toBe("8.2 Mbps");
    expect(fmtMbps(18_000)).toBe("18 Mbps");
  });
});

describe("Last 24 hours card", () => {
  const M = 60_000;
  const p = (ts: number, over: Partial<TrendPoint> = {}): TrendPoint =>
    ({ ts, cpu: null, mem: null, gpu: null, net_rx: null, net_tx: null, ...over });

  it("summarizes the average and when the peak was", () => {
    const s = summarize([p(0, { cpu: 10 }), p(5 * M, { cpu: 70 }), p(10 * M, { cpu: 40 }), p(15 * M)], "cpu");
    expect(s).toEqual({ avg: 40, peak: 70, peakTs: 5 * M });
    expect(summarize([p(0)], "gpu")).toBeNull();
  });

  it("adds up bytes moved, but not across a gap in the data", () => {
    const t = transferred([
      p(0,      { net_rx: 1000, net_tx: 100 }),
      p(5 * M,  { net_rx: 1000, net_tx: 100 }),
      p(65 * M, { net_rx: 1000, net_tx: 100 }),   // an hour with nothing recorded
    ]);
    expect(t).toEqual({ rx: 1000 * 300, tx: 100 * 300 });   // only the first 5 min counts
  });

  it("breaks the line where the data stops instead of bridging it", () => {
    const from = 0, W = 600, H = 150, DAY = 86_400_000;
    const { line } = trendPaths([
      p(DAY / 2, { cpu: 50 }), p(DAY / 2 + 5 * M, { cpu: 50 }),
      p(DAY / 2 + 3 * 3_600_000, { cpu: 20 }), p(DAY / 2 + 3 * 3_600_000 + 5 * M, { cpu: 20 }),
    ], "cpu", from, W, H);
    expect(line.match(/M/g)).toHaveLength(2);       // two runs, not one
    expect(line.startsWith("M300.0,")).toBe(true);   // placed on a 24 h axis, not stretched
  });
});

describe("Disk health table", () => {
  const disk = (over: Partial<SmartDisk> = {}): SmartDisk => ({
    device: "/dev/sda", kind: "sata", model: "WD", serial: "", temperature: 40, powerOnHours: 1000,
    reallocatedSectors: 0, pendingSectors: 0, uncorrectableSectors: 0, healthy: true, history: [], ...over,
  });

  it("uses drive-appropriate warm and hot limits", () => {
    expect(tempLimits("sata")).toEqual({ warn: 50, crit: 55 });
    expect(tempLimits("nvme")).toEqual({ warn: 70, crit: 80 });
    expect(scalePct(20)).toBe(0);
    expect(scalePct(50)).toBe(50);
    expect(scalePct(95)).toBe(100);
  });

  it("totals bad sectors and says when a drive doesn't report them", () => {
    expect(diskErrors(disk()).total).toBe(0);
    expect(diskErrors(disk({ reallocatedSectors: 8, pendingSectors: 1 }))).toEqual({ total: 9, detail: "8 reallocated · 1 pending · 0 uncorrectable" });
    expect(diskErrors(disk({ reallocatedSectors: null, pendingSectors: null, uncorrectableSectors: null })))
      .toEqual({ total: null, detail: "Not reported" });
  });

  it("writes ages in years once a drive is past one", () => {
    expect(fmtAge(62_200)).toBe("7.1 years");
    expect(fmtAge(2_400)).toBe("100 days");
  });
});

describe("friendlyDriveName", () => {
  it("reads family and size out of WD and Seagate part numbers", () => {
    expect(friendlyDriveName("WDC WD60PURZ-85ZUFY1")).toBe("WD Purple 6 TB");
    expect(friendlyDriveName("WDC WD40EFPX-68C6CN0")).toBe("WD Red Plus 4 TB");
    expect(friendlyDriveName("WDC WD80EFAX-68KNBN0")).toBe("WD Red 8 TB");
    expect(friendlyDriveName("WDC WD101KFBX-68R56N0")).toBe("WD Red Pro 10 TB");
    expect(friendlyDriveName("WDC WD4003FFBX-68MU3N0")).toBe("WD Red Pro 4 TB");
    expect(friendlyDriveName("WDC WD10EZEX-08WN4A0")).toBe("WD Blue 1 TB");
    expect(friendlyDriveName("ST4000VN008-2DR166")).toBe("Seagate IronWolf 4 TB");
    expect(friendlyDriveName("ST16000NM001G-2KK103")).toBe("Seagate Exos 16 TB");
  });

  it("leaves anything it doesn't recognise alone", () => {
    expect(friendlyDriveName("CUSU CV3500Q 512GB")).toBeNull();
    expect(friendlyDriveName("WDC WD40ZZZZ-00")).toBeNull();
    expect(friendlyDriveName("")).toBeNull();
  });
});

describe("Disk health ordering and labels", () => {
  const disk = (device: string, over: Partial<SmartDisk> = {}): SmartDisk => ({
    device, kind: "sata", model: "WD", serial: "", temperature: 40, powerOnHours: 1000,
    reallocatedSectors: 0, pendingSectors: 0, uncorrectableSectors: 0, healthy: true, history: [], ...over,
  });

  it("puts problems first, then the warmest, then by name", () => {
    const order = sortDisks([
      disk("/dev/sda", { temperature: 40 }),
      disk("/dev/sdb", { temperature: 46 }),
      disk("/dev/sdc", { temperature: 52 }),                       // warm
      disk("/dev/sdd", { temperature: 38, pendingSectors: 2 }),    // bad sectors
      disk("/dev/nvme0", { kind: "nvme", temperature: 60 }),       // fine for NVMe
      disk("/dev/sde", { temperature: 40 }),
    ]).map(d => d.device);
    expect(order).toEqual(["/dev/sdd", "/dev/sdc", "/dev/nvme0", "/dev/sdb", "/dev/sda", "/dev/sde"]);
  });

  it("names SMART attributes readably, and copes with unknown ones", () => {
    expect(attrLabel("reallocated_sector_ct")).toBe("Reallocated sectors");
    expect(attrLabel("udma_crc_error_count")).toBe("Cable / interface errors");
    expect(attrLabel("head_flying_hours")).toBe("Head flying hours");
  });
});
