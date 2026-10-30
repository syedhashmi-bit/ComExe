"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { DataUnit } from "@/app/lib/types";
import { fmtBytes, withAlpha } from "@/app/lib/formatters";
import { usePollingInterval } from "@/app/hooks/usePolling";
import { isDemoMode } from "@/app/lib/demo-data";
import { Segmented } from "@/app/components/PageHeader";
import { MirroredChart } from "@/app/components/NetworkChart";

// The last 24 hours of CPU, memory, network and GPU, from the history the
// server already records every 10–30 s (/api/history) — the card charts only
// cover the last ten minutes. No new load on the homelab: one request every
// five minutes, against our own file. A short preview of /analytics.

const DAY = 86_400_000;
const BUCKET = 5 * 60_000;           // 288 points across the day
const GAP = 3 * BUCKET;              // longer than this with no data = a gap, not a line

export interface TrendPoint {
  ts: number;
  cpu: number | null;
  mem: number | null;
  gpu: number | null;
  net_rx: number | null;
  net_tx: number | null;
}

type PctKey = "cpu" | "mem" | "gpu";
type Tab = PctKey | "net";

export function summarize(points: TrendPoint[], key: PctKey): { avg: number; peak: number; peakTs: number } | null {
  const vals = points.filter(p => p[key] != null);
  if (vals.length === 0) return null;
  let peak = vals[0];
  for (const p of vals) if (p[key]! > peak[key]!) peak = p;
  return { avg: vals.reduce((s, p) => s + p[key]!, 0) / vals.length, peak: peak[key]!, peakTs: peak.ts };
}

// Bytes moved: each point's average rate × the time to the next point. A
// stretch with no data (server down, dashboard stopped) adds nothing rather
// than being bridged with a guess.
export function transferred(points: TrendPoint[], maxGapMs = GAP): { rx: number; tx: number } {
  let rx = 0, tx = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], dt = points[i].ts - a.ts;
    if (dt <= 0 || dt > maxGapMs) continue;
    rx += (a.net_rx ?? 0) * dt / 1000;
    tx += (a.net_tx ?? 0) * dt / 1000;
  }
  return { rx, tx };
}

// SVG line and area paths over a fixed 24 h window, broken wherever the data
// stops for longer than GAP — so "recording since 14:00" shows as an empty
// left side, not a line stretched across the whole day.
export function trendPaths(points: TrendPoint[], key: PctKey, from: number, W: number, H: number) {
  const x = (ts: number) => ((ts - from) / DAY) * W;
  const y = (v: number) => H - (Math.min(100, Math.max(0, v)) / 100) * (H - 2) - 1;
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  let lastTs = -Infinity;
  for (const p of points) {
    const v = p[key];
    if (v == null || p.ts - lastTs > GAP) { if (run.length) runs.push(run); run = []; }
    if (v != null) { run.push({ x: x(p.ts), y: y(v) }); lastTs = p.ts; }
  }
  if (run.length) runs.push(run);
  const seg = (r: { x: number; y: number }[]) => r.map((pt, i) => `${i ? "L" : "M"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
  return {
    line: runs.map(seg).join(" "),
    area: runs.filter(r => r.length > 1).map(r => `${seg(r)} L${r[r.length - 1].x.toFixed(1)},${H} L${r[0].x.toFixed(1)},${H} Z`).join(" "),
  };
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function demoPoints(): TrendPoint[] {
  const now = Date.now();
  return Array.from({ length: 288 }, (_, i) => {
    const ts = now - (287 - i) * BUCKET, h = new Date(ts).getHours() + new Date(ts).getMinutes() / 60;
    const evening = Math.exp(-((h - 21) ** 2) / 6);       // Plex in the evening
    const night = Math.exp(-((h - 3) ** 2) / 2);          // scrubs and downloads overnight
    return {
      ts,
      cpu: Math.round((12 + 30 * night + 18 * evening + 6 * Math.sin(i / 5)) * 10) / 10,
      mem: Math.round((50 + 6 * night + 3 * evening + Math.sin(i / 17)) * 10) / 10,
      gpu: Math.round((4 + 55 * evening * (0.6 + 0.4 * Math.sin(i / 3) ** 2)) * 10) / 10,
      net_rx: Math.round((2e6 + 30e6 * night + 6e6 * evening) * (0.8 + 0.4 * Math.sin(i / 4) ** 2)),
      net_tx: Math.round((0.4e6 + 9e6 * evening) * (0.8 + 0.4 * Math.cos(i / 6) ** 2)),
    };
  });
}

const PCT: Record<PctKey, { label: string; color: string }> = {
  cpu: { label: "CPU",    color: "var(--accent-cpu)" },
  mem: { label: "Memory", color: "var(--accent-memory)" },
  gpu: { label: "GPU",    color: "var(--accent-gpu)" },
};

function PctChart({ points, k, now }: { points: TrendPoint[]; k: PctKey; now: number }) {
  const W = 600, H = 150;
  const [hover, setHover] = useState<TrendPoint | null>(null);
  const from = now - DAY;
  const { line, area } = trendPaths(points, k, from, W, H);
  const color = PCT[k].color;
  const withVal = points.filter(p => p[k] != null);
  const pos = hover ? ((hover.ts - from) / DAY) * 100 : 0;
  const axis: React.CSSProperties = { position: "absolute", right: 0, fontSize: 12, lineHeight: "16px", color: "var(--text-ghost)", fontFamily: "var(--font-mono)", background: "var(--card)", paddingLeft: 4, pointerEvents: "none" };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative" style={{ height: H }}
        onMouseMove={e => {
          if (withVal.length === 0) return;
          const b = e.currentTarget.getBoundingClientRect();
          const ts = from + ((e.clientX - b.left) / b.width) * DAY;
          let best = withVal[0];
          for (const p of withVal) if (Math.abs(p.ts - ts) < Math.abs(best.ts - ts)) best = p;
          setHover(Math.abs(best.ts - ts) <= GAP ? best : null);
        }}
        onMouseLeave={() => setHover(null)}>
        <svg role="img" aria-label={`${PCT[k].label} over the last 24 hours`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H, display: "block" }}>
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--divider)", strokeWidth: 1 }} />
          ))}
          <path d={area} style={{ fill: withAlpha(color, 18) }} />
          <path d={line} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: color, strokeWidth: 1.6, strokeLinejoin: "round" }} />
        </svg>
        <span style={{ ...axis, top: 0 }}>100%</span>
        <span style={{ ...axis, top: H / 2 - 8 }}>50%</span>
        {hover && (
          <>
            <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: `${pos}%`, width: 1, background: "var(--border-hover)", pointerEvents: "none" }} />
            <span aria-hidden="true" style={{
              position: "absolute", left: `${pos}%`, top: H - (hover[k]! / 100) * (H - 2) - 1, width: 8, height: 8, borderRadius: 4,
              transform: "translate(-50%, -50%)", background: color, border: "2px solid var(--card)", pointerEvents: "none",
            }} />
            <div style={{
              position: "absolute", top: 6, pointerEvents: "none",
              ...(pos > 55 ? { right: `calc(${100 - pos}% + 10px)` } : { left: `calc(${pos}% + 10px)` }),
              padding: "6px 9px", background: "var(--surface)", border: "1px solid var(--border-mid)", borderRadius: 8,
              display: "flex", flexDirection: "column", gap: 2, whiteSpace: "nowrap",
              fontSize: 12, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
            }}>
              <span style={{ color: "var(--text-faint)" }}>{hhmm(hover.ts)}</span>
              <span style={{ color: "var(--text)" }}>{PCT[k].label} {hover[k]!.toFixed(0)}%</span>
            </div>
          </>
        )}
      </div>
      <div className="flex justify-between" style={{ fontSize: 12, color: "var(--text-ghost)", fontFamily: "var(--font-mono)" }}>
        <span>24 h ago</span><span>12 h ago</span><span>Now</span>
      </div>
    </div>
  );
}

export function TrendsCard({ du }: { du: DataUnit }) {
  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  const [now, setNow] = useState(0);
  const [tab, setTab] = useState<Tab>("cpu");

  // Demo data arrives through the same path as real data, after mount, so the
  // server render and the first client render agree.
  const load = useCallback(async () => {
    if (isDemoMode()) { setPoints(demoPoints()); setNow(Date.now()); return; }
    try {
      const res = await fetch("/api/history?range=24h&limit=288", { cache: "no-store" });
      if (!res.ok) return;
      const d: { points?: TrendPoint[] } = await res.json();
      setPoints(d.points ?? []);
      setNow(Date.now());
    } catch { /* keep the last one */ }
  }, []);
  usePollingInterval(load, 5 * 60_000);

  const hasGpu = !!points?.some(p => p.gpu != null);
  const tabs: { key: Tab; label: string }[] = [
    { key: "cpu", label: "CPU" }, { key: "mem", label: "Memory" }, { key: "net", label: "Network" },
    ...(hasGpu ? [{ key: "gpu" as const, label: "GPU" }] : []),
  ];
  const active: Tab = tab === "gpu" && !hasGpu ? "cpu" : tab;
  const first = points?.[0];
  const since = first && first.ts > now - DAY + 60 * 60_000 ? ` · recording since ${hhmm(first.ts)}` : "";

  let summary = "";
  if (points?.length) {
    if (active === "net") {
      const t = transferred(points);
      summary = `↓ ${fmtBytes(t.rx, 1, du)} · ↑ ${fmtBytes(t.tx, 1, du)} transferred${since}`;
    } else {
      const s = summarize(points, active);
      if (s) summary = `Average ${s.avg.toFixed(0)}% · peak ${s.peak.toFixed(0)}% at ${hhmm(s.peakTs)}${since}`;
    }
  }
  const net = (points ?? []).filter(p => p.net_rx != null && p.net_tx != null);

  return (
    <section aria-label="Last 24 hours" style={{
      background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
      padding: 16, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div className="flex flex-wrap items-center" style={{ columnGap: 12, rowGap: 8 }}>
        <span className="flex items-center gap-2">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-system)" }}>
            <path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 6-6" />
          </svg>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Last 24 hours</span>
        </span>
        <span className="ml-auto flex items-center" style={{ gap: 12 }}>
          <Segmented label="Metric" options={tabs} value={active} onChange={setTab} />
          <Link href="/analytics" style={{ fontSize: 12, color: "var(--brand)", whiteSpace: "nowrap" }}>Analytics →</Link>
        </span>
      </div>

      {points == null ? (
        <div className="skeleton rounded" style={{ height: 172 }} />
      ) : points.length < 2 ? (
        <span style={{ fontSize: 12, color: "var(--text-faint)", padding: "24px 0" }}>
          No history yet. The dashboard saves a reading every 10–30 seconds, so this fills in over the day.
        </span>
      ) : active === "net" ? (
        <MirroredChart
          up={{ values: net.map(p => p.net_rx!), color: "var(--accent-network)", arrow: "↓" }}
          down={{ values: net.map(p => p.net_tx!), color: "var(--accent-network-tx)", arrow: "↑" }}
          times={net.map(p => p.ts)} height={150}
          fmt={v => `${fmtBytes(v, 1, du)}/s`}
          ariaLabel="Download above the line, upload below, last 24 hours"
        />
      ) : (
        <PctChart points={points} k={active} now={now} />
      )}

      {summary && <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{summary}</span>}
    </section>
  );
}
