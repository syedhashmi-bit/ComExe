// ── Historical metric persistence ───────────────────────────────────────────
// Append-only JSONL ring buffer at data/history.jsonl. Rotated at MAX_SIZE_MB
// or MAX_AGE_DAYS, whichever comes first. Exposed via /api/history.
//
// Each line is a JSON object with { ts, cpu, mem, net_rx, net_tx, gpu, disk_pct }.
// Kept intentionally slim — one line per poll cycle (~every 3s), so 7 days of
// 3s polls ≈ 200k lines ≈ ~30MB uncompressed.
//
// IMPORTANT: server-only. Never import from "use client" modules.

import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR      = path.join(process.cwd(), "data");
const HISTORY_PATH  = path.join(DATA_DIR, "history.jsonl");
const MAX_SIZE_MB   = 50;
const MAX_AGE_DAYS  = 7;

export interface HistoryPoint {
  ts:       number;   // epoch ms
  cpu:      number | null;
  mem:      number | null;   // used %
  net_rx:   number | null;   // bytes/sec
  net_tx:   number | null;   // bytes/sec
  gpu:      number | null;   // utilization %
  disk_pct: number | null;   // worst mount %
}

// Append a single data point. Creates the file + dir on first write.
//
// Rotation is triggered from here rather than from the POST /api/history route
// where it used to live: the real write path is the metrics route calling this
// function directly, and nothing ever POSTs, so rotation never ran at all and
// the file grew without bound.
let writesSinceRotate = 0;
const ROTATE_EVERY_WRITES = 500; // ~85 min at a 10s poll interval

export async function appendHistory(point: HistoryPoint): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const line = JSON.stringify(point) + "\n";
    await fs.appendFile(HISTORY_PATH, line, "utf8");
  } catch {
    // Non-fatal — history is best-effort
    return;
  }

  if (++writesSinceRotate >= ROTATE_EVERY_WRITES) {
    writesSinceRotate = 0;
    rotateHistory().catch(() => {});
  }
}

// Read history, optionally filtered by metric and time range.
export async function readHistory(opts?: {
  metric?: keyof Omit<HistoryPoint, "ts">;
  rangeMs?: number;   // only points within this many ms from now
  limit?: number;     // max points to return (tail)
}): Promise<HistoryPoint[]> {
  let raw: string;
  try {
    raw = await fs.readFile(HISTORY_PATH, "utf8");
  } catch {
    return [];
  }

  const cutoff = opts?.rangeMs ? Date.now() - opts.rangeMs : 0;
  const lines = raw.trim().split("\n");

  // Walk backwards from the newest line. Points are appended in timestamp
  // order, so the first line older than the cutoff means everything before it
  // is older too — we can stop there instead of parsing the whole file. Asking
  // for one hour out of seven days used to cost a full-file parse on every
  // /api/history and /api/insights request.
  const limit = opts?.limit;
  const collected: HistoryPoint[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let p: HistoryPoint;
    try {
      p = JSON.parse(line) as HistoryPoint;
    } catch {
      continue; // skip corrupt lines
    }
    if (p.ts < cutoff) break;
    collected.push(p);
    if (limit && collected.length >= limit) break;
  }

  return collected.reverse(); // restore oldest → newest
}

// Downsample points for charting — average into buckets of `bucketMs` width.
export function downsample(points: HistoryPoint[], bucketMs: number): HistoryPoint[] {
  if (points.length === 0 || bucketMs <= 0) return points;

  const result: HistoryPoint[] = [];
  let bucketStart = points[0].ts;
  let bucket: HistoryPoint[] = [];

  for (const p of points) {
    if (p.ts - bucketStart >= bucketMs && bucket.length > 0) {
      result.push(avgBucket(bucket));
      bucket = [];
      bucketStart = p.ts;
    }
    bucket.push(p);
  }
  if (bucket.length > 0) result.push(avgBucket(bucket));
  return result;
}

function avgBucket(bucket: HistoryPoint[]): HistoryPoint {
  const n = bucket.length;
  const avg = (key: keyof Omit<HistoryPoint, "ts">): number | null => {
    const vals = bucket.map(b => b[key]).filter((v): v is number => v !== null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    ts:       Math.round(bucket.reduce((s, b) => s + b.ts, 0) / n),
    cpu:      avg("cpu"),
    mem:      avg("mem"),
    net_rx:   avg("net_rx"),
    net_tx:   avg("net_tx"),
    gpu:      avg("gpu"),
    disk_pct: avg("disk_pct"),
  };
}

// Rotate: delete lines older than MAX_AGE_DAYS or truncate if > MAX_SIZE_MB.
export async function rotateHistory(): Promise<void> {
  try {
    const stat = await fs.stat(HISTORY_PATH);
    const sizeMB = stat.size / (1024 * 1024);

    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    const raw = await fs.readFile(HISTORY_PATH, "utf8");
    const lines = raw.trim().split("\n");
    let kept: string[] = [];

    for (const line of lines) {
      try {
        const p = JSON.parse(line) as { ts: number };
        if (p.ts >= cutoff) kept.push(line);
      } catch { /* drop corrupt */ }
    }

    // Size is the backstop for the age rule: if a week of data still exceeds
    // the cap (very fast polling), keep the newest lines that fit. Previously
    // this whole function bailed out unless the file was already near 50MB,
    // which made the "7 days OR 50MB, whichever comes first" contract false —
    // age-based rotation could never fire on its own.
    if (sizeMB >= MAX_SIZE_MB) {
      const avgLineBytes = Math.max(1, stat.size / Math.max(1, lines.length));
      const maxLines = Math.floor((MAX_SIZE_MB * 1024 * 1024) / avgLineBytes);
      if (kept.length > maxLines) kept = kept.slice(-maxLines);
    }

    if (kept.length === lines.length) return; // nothing to drop — skip the write
    await fs.writeFile(HISTORY_PATH, kept.length ? kept.join("\n") + "\n" : "", "utf8");
  } catch {
    // Non-fatal
  }
}
