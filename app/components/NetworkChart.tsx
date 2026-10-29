"use client";

import { useState } from "react";
import type { DataUnit } from "@/app/lib/types";
import { fmtBytes, withAlpha } from "@/app/lib/formatters";
import { Sparkline } from "@/app/components/primitives";

// Two series in one chart: one above the centre line, the other below it,
// each on its own scale — upload is usually a fraction of download, and on a
// shared scale it would draw as a flat line. Hovering reads out both at that
// moment. Used for network throughput and for speedtest history.

const W = 300; // viewBox width; the SVG stretches to the card

// Round a peak up to a readable axis maximum (1, 1.5, 2, 3, 5, 7.5 × 10^n).
// `floor` keeps an idle series from getting a silly tiny scale.
export function niceMax(v: number, floor = 1024): number {
  const x = Math.max(v, floor);
  const pow = 10 ** Math.floor(Math.log10(x));
  const step = [1, 1.5, 2, 3, 5, 7.5, 10].find(s => x <= s * pow) ?? 10;
  return step * pow;
}

// "12 min ago", "6 h ago", "9 days ago" — the left end of the time axis.
export function spanLabel(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 120) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function paths(vals: number[], max: number, height: number, below: boolean) {
  const mid = height / 2, half = mid - 1;
  const line = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const d = (Math.min(Math.max(v, 0), max) / max) * half;
    return `${i ? "L" : "M"}${x.toFixed(1)},${(below ? mid + d : mid - d).toFixed(1)}`;
  }).join(" ");
  return { line, area: `${line} L${W},${mid} L0,${mid} Z` };
}

export interface MirroredSeries {
  values: number[];
  color:  string;
  arrow:  string;    // "↓" / "↑", leads the hover readout
}

export function MirroredChart({ up, down, times, fmt, floor, height = 150, ariaLabel, extra, fill = true }: {
  up: MirroredSeries;
  down: MirroredSeries;
  times: number[];
  fmt: (v: number) => string;
  floor?: number;
  height?: number;
  ariaLabel: string;
  extra?: (i: number) => string | null;   // one more hover line, e.g. ping
  // Off for series that sit near their maximum (speedtests): the area would
  // fill the half and hide the test-to-test changes the lines show.
  fill?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.min(up.values.length, down.values.length);
  if (n < 2) return <Sparkline data={[]} color={up.color} height={height} />;

  const u = up.values.slice(-n), d = down.values.slice(-n);
  const ts = times.length >= n ? times.slice(-n) : null;
  const uMax = niceMax(Math.max(...u), floor);
  const dMax = niceMax(Math.max(...d), floor);
  const upP = paths(u, uMax, height, false);
  const downP = paths(d, dMax, height, true);
  const mid = height / 2, half = mid - 1;
  const span = ts ? ts[n - 1] - ts[0] : 0;
  // Long spans (speedtests) need the day; short ones (live network) the seconds.
  const when = (t: number) => span > 20 * 3_600_000
    ? new Date(t).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const pos = hover != null ? (hover / (n - 1)) * 100 : 0;
  const dotY = (v: number, max: number, below: boolean) => {
    const off = (Math.min(Math.max(v, 0), max) / max) * half;
    return below ? mid + off : mid - off;
  };
  // A card-coloured chip, so a line running along the top or bottom edge passes
  // behind the label instead of striking through it.
  const scaleLabel: React.CSSProperties = {
    position: "absolute", left: 0, fontSize: 12, lineHeight: "16px", color: "var(--text-ghost)",
    fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", pointerEvents: "none",
    background: "var(--card)", padding: "0 4px 0 0", borderRadius: 3,
  };
  const extraLine = hover != null ? extra?.(hover) ?? null : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative" style={{ height }}
        onMouseMove={e => {
          const b = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * (n - 1)));
        }}
        onMouseLeave={() => setHover(null)}>
        <svg role="img" aria-label={ariaLabel}
          viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height, display: "block" }}>
          {fill && <path d={upP.area} style={{ fill: withAlpha(up.color, 20) }} />}
          <path d={upP.line} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: up.color, strokeWidth: 1.6, strokeLinejoin: "round" }} />
          {fill && <path d={downP.area} style={{ fill: withAlpha(down.color, 20) }} />}
          <path d={downP.line} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: down.color, strokeWidth: 1.6, strokeLinejoin: "round" }} />
        </svg>
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: mid, height: 1, background: "var(--border-mid)" }} />
        <span style={{ ...scaleLabel, top: 0 }}>{fmt(uMax)}</span>
        <span style={{ ...scaleLabel, bottom: 0 }}>{fmt(dMax)}</span>

        {hover != null && (
          <>
            <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: `${pos}%`, width: 1, background: "var(--border-hover)", pointerEvents: "none" }} />
            {[
              { y: dotY(u[hover], uMax, false), c: up.color },
              { y: dotY(d[hover], dMax, true),  c: down.color },
            ].map((dot, i) => (
              <span key={i} aria-hidden="true" style={{
                position: "absolute", left: `${pos}%`, top: dot.y, width: 8, height: 8, borderRadius: 4,
                transform: "translate(-50%, -50%)", background: dot.c, border: "2px solid var(--card)", pointerEvents: "none",
              }} />
            ))}
            <div style={{
              position: "absolute", top: 6, pointerEvents: "none",
              ...(pos > 55 ? { right: `calc(${100 - pos}% + 10px)` } : { left: `calc(${pos}% + 10px)` }),
              padding: "6px 9px", background: "var(--surface)", border: "1px solid var(--border-mid)", borderRadius: 8,
              display: "flex", flexDirection: "column", gap: 2, whiteSpace: "nowrap",
              fontSize: 12, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
            }}>
              {ts && <span style={{ color: "var(--text-faint)" }}>{when(ts[hover])}</span>}
              <span style={{ color: "var(--text)" }}>{up.arrow} {fmt(u[hover])}</span>
              <span style={{ color: "var(--text)" }}>{down.arrow} {fmt(d[hover])}</span>
              {extraLine && <span style={{ color: "var(--text-muted)" }}>{extraLine}</span>}
            </div>
          </>
        )}
      </div>
      {ts && (
        <div className="flex justify-between" style={{ fontSize: 12, color: "var(--text-ghost)", fontFamily: "var(--font-mono)" }}>
          <span>{spanLabel(span)}</span><span>Now</span>
        </div>
      )}
    </div>
  );
}

export function NetworkChart({ rx, tx, times, du, height = 150 }: {
  rx: number[]; tx: number[]; times: number[]; du: DataUnit; height?: number;
}) {
  const n = Math.min(rx.length, tx.length, times.length);
  const minutes = n > 1 ? Math.max(1, Math.round((times[times.length - 1] - times[times.length - n]) / 60_000)) : null;
  return (
    <MirroredChart
      up={{ values: rx, color: "var(--accent-network)", arrow: "↓" }}
      down={{ values: tx, color: "var(--accent-network-tx)", arrow: "↑" }}
      times={times} height={height}
      fmt={v => `${fmtBytes(v, 1, du)}/s`}
      ariaLabel={`Download above the line, upload below${minutes ? `, last ${minutes} min` : ""}`}
    />
  );
}
