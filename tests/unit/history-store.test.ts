import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory fs so these never touch the real data/ directory.
const files = new Map<string, string>();

vi.mock("node:fs", () => ({
  promises: {
    mkdir:      vi.fn(async () => undefined),
    appendFile: vi.fn(async (p: string, d: string) => { files.set(p, (files.get(p) ?? "") + d); }),
    writeFile:  vi.fn(async (p: string, d: string) => { files.set(p, d); }),
    readFile:   vi.fn(async (p: string) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    }),
    stat: vi.fn(async (p: string) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { size: Buffer.byteLength(files.get(p)!, "utf8") };
    }),
  },
}));

const DAY = 86_400_000;

function line(ts: number, cpu: number): string {
  return JSON.stringify({ ts, cpu, mem: null, net_rx: null, net_tx: null, gpu: null, disk_pct: null }) + "\n";
}

function historyPath(): string {
  // Matches path.join(process.cwd(), "data", "history.jsonl") in history.ts.
  return [...files.keys()].find(k => k.endsWith("history.jsonl"))!;
}

describe("history store", () => {
  beforeEach(() => {
    files.clear();
    vi.resetModules();
  });

  it("reads only points inside the requested range", async () => {
    const { appendHistory, readHistory } = await import("@/app/lib/history");
    const now = Date.now();
    await appendHistory({ ts: now - 5 * DAY, cpu: 10, mem: null, net_rx: null, net_tx: null, gpu: null, disk_pct: null });
    await appendHistory({ ts: now - 30_000,  cpu: 20, mem: null, net_rx: null, net_tx: null, gpu: null, disk_pct: null });
    await appendHistory({ ts: now - 10_000,  cpu: 30, mem: null, net_rx: null, net_tx: null, gpu: null, disk_pct: null });

    const recent = await readHistory({ rangeMs: 60_000 });
    expect(recent.map(p => p.cpu)).toEqual([20, 30]); // oldest → newest, 5-day-old point excluded
  });

  it("applies limit to the NEWEST points, not the oldest", async () => {
    const { readHistory } = await import("@/app/lib/history");
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const p = path.join(process.cwd(), "data", "history.jsonl");
    const now = Date.now();
    await fs.writeFile(p, [line(now - 4000, 1), line(now - 3000, 2), line(now - 2000, 3), line(now - 1000, 4)].join(""), "utf8");

    const points = await readHistory({ limit: 2 });
    expect(points.map(x => x.cpu)).toEqual([3, 4]);
  });

  it("returns empty when no history file exists", async () => {
    const { readHistory } = await import("@/app/lib/history");
    expect(await readHistory({ rangeMs: 60_000 })).toEqual([]);
  });

  it("skips corrupt lines without dropping valid ones", async () => {
    const { readHistory } = await import("@/app/lib/history");
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const p = path.join(process.cwd(), "data", "history.jsonl");
    const now = Date.now();
    await fs.writeFile(p, line(now - 3000, 1) + "{not json\n" + line(now - 1000, 2), "utf8");

    expect((await readHistory({ rangeMs: 60_000 })).map(x => x.cpu)).toEqual([1, 2]);
  });

  it("rotates out points older than the retention window regardless of file size", async () => {
    // Regression: rotateHistory() used to bail out unless the file was already
    // ~40MB, so age-based rotation could never fire on a small file.
    // Retention defaults to 30 days (so /forecast's 30d range has data).
    const { rotateHistory } = await import("@/app/lib/history");
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const p = path.join(process.cwd(), "data", "history.jsonl");
    const now = Date.now();
    await fs.writeFile(p, [line(now - 40 * DAY, 1), line(now - 8 * DAY, 2), line(now - 1000, 3)].join(""), "utf8");

    await rotateHistory();

    const remaining = files.get(historyPath())!.trim().split("\n").map(l => JSON.parse(l).cpu);
    expect(remaining).toEqual([2, 3]); // 40-day point dropped; 8-day point now inside the window
  });

  it("triggers rotation from the append path", async () => {
    // Regression: rotation was only wired to POST /api/history, which nothing
    // ever calls — the real writer is the metrics route calling appendHistory.
    const { appendHistory } = await import("@/app/lib/history");
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const p = path.join(process.cwd(), "data", "history.jsonl");
    const now = Date.now();

    // Seed one point well outside the retention window, then append enough
    // times to cross the rotation trigger.
    await fs.writeFile(p, line(now - 40 * DAY, 99), "utf8");
    for (let i = 0; i < 500; i++) {
      await appendHistory({ ts: now + i, cpu: 1, mem: null, net_rx: null, net_tx: null, gpu: null, disk_pct: null });
    }
    await new Promise(r => setTimeout(r, 0)); // rotation is fire-and-forget

    const cpus = files.get(historyPath())!.trim().split("\n").map(l => JSON.parse(l).cpu);
    expect(cpus).not.toContain(99); // the stale point was rotated away
  });
});
