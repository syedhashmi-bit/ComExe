"use client";

import { useState } from "react";
import type { DataUnit } from "@/app/lib/types";
import { fmtBytes, withAlpha } from "@/app/lib/formatters";
import { Sparkline } from "@/app/components/primitives";

// Download above the centre line, upload below it, in one chart. Each half has
// its own scale: upload is usually a fraction of download, and on a shared
// scale it would draw as a flat line. Hovering reads out both at that moment.

const W = 300; // viewBox width; the SVG stretches to the card

// Round a peak up to a readable axis maximum (1, 1.5, 2, 3, 5, 7.5 × 10^n).
export function niceMax(v: number): number {
  const x = Math.max(v, 1024);
  const pow = 10 ** Math.floor(Math.log10(x));
  const step = [1, 1.5, 2, 3, 5, 7.5, 10].find(s => x <= s * pow) ?? 10;
  return step * pow;
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

export function NetworkChart({ rx, tx, times, du, height = 150 }: {
  rx: number[]; tx: number[]; times: number[]; du: DataUnit; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.min(rx.length, tx.length);
  if (n < 2) return <Sparkline data={[]} color="var(--accent-network)" height={height} />;

  const r = rx.slice(-n), t = tx.slice(-n);
  const ts = times.length >= n ? times.slice(-n) : null;
  const rxMax = niceMax(Math.max(...r));
  const txMax = niceMax(Math.max(...t));
  const up = paths(r, rxMax, height, false);
  const down = paths(t, txMax, height, true);
  const mid = height / 2, half = mid - 1;
  const rate = (v: number) => `${fmtBytes(v, 1, du)}/s`;
  const spanMin = ts ? Math.max(1, Math.round((ts[n - 1] - ts[0]) / 60_000)) : null;

  const pos = hover != null ? (hover / (n - 1)) * 100 : 0;
  const dotY = (v: number, max: number, below: boolean) => {
    const d = (Math.min(Math.max(v, 0), max) / max) * half;
    return below ? mid + d : mid - d;
  };
  const scaleLabel: React.CSSProperties = {
    position: "absolute", left: 0, fontSize: 12, color: "var(--text-ghost)",
    fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", pointerEvents: "none",
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative" style={{ height }}
        onMouseMove={e => {
          const b = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)) * (n - 1)));
        }}
        onMouseLeave={() => setHover(null)}>
        <svg role="img" aria-label={`Download above the line, upload below${spanMin ? `, last ${spanMin} min` : ""}`}
          viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height, display: "block" }}>
          <path d={up.area} style={{ fill: withAlpha("var(--accent-network)", 20) }} />
          <path d={up.line} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: "var(--accent-network)", strokeWidth: 1.6, strokeLinejoin: "round" }} />
          <path d={down.area} style={{ fill: withAlpha("var(--accent-network-tx)", 20) }} />
          <path d={down.line} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: "var(--accent-network-tx)", strokeWidth: 1.6, strokeLinejoin: "round" }} />
        </svg>
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: mid, height: 1, background: "var(--border-mid)" }} />
        <span style={{ ...scaleLabel, top: 0 }}>{rate(rxMax)}</span>
        <span style={{ ...scaleLabel, bottom: 0 }}>{rate(txMax)}</span>

        {hover != null && (
          <>
            <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: `${pos}%`, width: 1, background: "var(--border-hover)", pointerEvents: "none" }} />
            {[
              { y: dotY(r[hover], rxMax, false), c: "var(--accent-network)" },
              { y: dotY(t[hover], txMax, true),  c: "var(--accent-network-tx)" },
            ].map(d => (
              <span key={d.c} aria-hidden="true" style={{
                position: "absolute", left: `${pos}%`, top: d.y, width: 8, height: 8, borderRadius: 4,
                transform: "translate(-50%, -50%)", background: d.c, border: "2px solid var(--card)", pointerEvents: "none",
              }} />
            ))}
            <div style={{
              position: "absolute", top: 6, pointerEvents: "none",
              ...(pos > 55 ? { right: `calc(${100 - pos}% + 10px)` } : { left: `calc(${pos}% + 10px)` }),
              padding: "6px 9px", background: "var(--surface)", border: "1px solid var(--border-mid)", borderRadius: 8,
              display: "flex", flexDirection: "column", gap: 2, whiteSpace: "nowrap",
              fontSize: 12, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
            }}>
              {ts && <span style={{ color: "var(--text-faint)" }}>{new Date(ts[hover]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
              <span style={{ color: "var(--text)" }}>↓ {rate(r[hover])}</span>
              <span style={{ color: "var(--text)" }}>↑ {rate(t[hover])}</span>
            </div>
          </>
        )}
      </div>
      {spanMin && (
        <div className="flex justify-between" style={{ fontSize: 12, color: "var(--text-ghost)", fontFamily: "var(--font-mono)" }}>
          <span>{spanMin} min ago</span><span>Now</span>
        </div>
      )}
    </div>
  );
}
