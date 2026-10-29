"use client";

import { withAlpha } from "@/app/lib/formatters";

// One cell per hardware thread, shaded in the CPU accent by how busy it is.
// It answers what the single average can't: is one thread pegged (a stuck
// process, a single-threaded transcode) while the rest idle? The shading is
// data, not status — a busy thread isn't an alert.

// Columns: everything on one row up to 16 threads, then as few even rows as
// fit 16 a row (28 → 2 × 14, 64 → 4 × 16).
export function threadColumns(n: number): number {
  if (n <= 16) return Math.max(n, 1);
  return Math.ceil(n / Math.ceil(n / 16));
}

export function busiestThreads(threads: number[], count = 3): { cpu: number; pct: number }[] {
  return threads
    .map((pct, cpu) => ({ cpu, pct }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, count);
}

export function CpuThreads({ threads }: { threads: number[] }) {
  if (threads.length < 2) return null;
  return (
    <div role="img" aria-label={`Load on each of the ${threads.length} CPU threads`}
      style={{ display: "grid", gridTemplateColumns: `repeat(${threadColumns(threads.length)}, minmax(0, 1fr))`, gap: 3 }}>
      {threads.map((pct, cpu) => (
        <span key={cpu} title={`cpu${cpu} · ${pct.toFixed(0)}%`} className="cpu-thread"
          style={{
            height: 22, borderRadius: 4,
            // Capped at 50% so the number stays readable (4.5:1) in both
            // themes with one text colour.
            background: withAlpha("var(--accent-cpu)", Math.round(8 + pct * 0.42)),
            color: "var(--text)",
            fontSize: 12, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
          }}>
          <span className="cpu-thread-num">{pct.toFixed(0)}</span>
        </span>
      ))}
    </div>
  );
}
