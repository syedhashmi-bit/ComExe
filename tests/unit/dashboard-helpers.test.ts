import { describe, it, expect } from "vitest";
import { threadColumns, busiestThreads } from "@/app/components/CpuThreads";
import { niceMax } from "@/app/components/NetworkChart";
import { fmtDays, forecastSentence } from "@/app/components/FilesystemsBody";
import { cellLevels } from "@/app/components/IncidentStrip";
import { fmtDuration } from "@/app/lib/formatters";
import { seedFromHistory, type SavedPoint } from "@/app/lib/history-seed";
import { statusIcon, statusTitle } from "@/app/hooks/useTabStatus";

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
