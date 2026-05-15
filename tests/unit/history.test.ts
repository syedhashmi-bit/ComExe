import { describe, it, expect } from "vitest";
import { downsample, type HistoryPoint } from "@/app/lib/history";

function point(ts: number, cpu: number): HistoryPoint {
  return { ts, cpu, mem: null, net_rx: null, net_tx: null, gpu: null, disk_pct: null };
}

describe("history downsample", () => {
  it("returns empty for empty input", () => {
    expect(downsample([], 1000)).toEqual([]);
  });

  it("returns single point unchanged", () => {
    const p = [point(1000, 50)];
    expect(downsample(p, 5000)).toEqual(p);
  });

  it("averages points within a bucket", () => {
    const points = [
      point(1000, 40),
      point(2000, 60),
      point(3000, 50),
    ];
    const result = downsample(points, 10000);
    expect(result).toHaveLength(1);
    expect(result[0].cpu).toBe(50); // avg(40, 60, 50)
  });

  it("splits into multiple buckets", () => {
    const points = [
      point(0, 10),
      point(1000, 20),
      point(5000, 80),
      point(6000, 90),
    ];
    const result = downsample(points, 3000);
    expect(result).toHaveLength(2);
    expect(result[0].cpu).toBe(15);  // avg(10, 20)
    expect(result[1].cpu).toBe(85);  // avg(80, 90)
  });

  it("handles null values gracefully", () => {
    const points = [
      { ts: 1000, cpu: null, mem: 50, net_rx: null, net_tx: null, gpu: null, disk_pct: null },
      { ts: 2000, cpu: null, mem: 70, net_rx: null, net_tx: null, gpu: null, disk_pct: null },
    ];
    const result = downsample(points, 10000);
    expect(result).toHaveLength(1);
    expect(result[0].cpu).toBeNull();
    expect(result[0].mem).toBe(60);
  });
});
