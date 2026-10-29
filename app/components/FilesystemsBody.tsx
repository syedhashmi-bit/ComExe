"use client";

import { useCallback, useState } from "react";
import type { DataUnit, Metrics, StorageInsight } from "@/app/lib/types";
import { fmtBytes } from "@/app/lib/formatters";
import { IconFolder } from "@/app/components/icons";
import { usePollingInterval } from "@/app/hooks/usePolling";
import { isDemoMode } from "@/app/lib/demo-data";

// The Filesystems card's body: pool headline, pool state and ZFS cache, the
// fill-up forecast from /api/storage, and the datasets with their weekly
// growth. /api/storage changes over days, so it's fetched every 10 minutes —
// never on the 10s metrics cadence.

const WARN = 85;
const CRIT = 95;
// Documented disk thresholds: warn >85%, critical >95%. Data accent below.
const fsBarColor = (p: number) => p > CRIT ? "var(--critical)" : p > WARN ? "var(--warn)" : "var(--accent-fs)";

// "about 3 weeks", "about 1.4 years" — forecasts are rough; say so.
export function fmtDays(d: number): string {
  if (d < 1.5)  return "a day";
  if (d < 14)   return `${Math.round(d)} days`;
  if (d < 60)   return `${Math.round(d / 7)} weeks`;
  if (d < 730)  return `${Math.round(d / 30.4)} months`;
  return `${(d / 365).toFixed(1)} years`;
}

export function forecastSentence(s: Pick<StorageInsight, "growthPerDay" | "daysToWarn" | "daysToFull">): string {
  if (s.growthPerDay == null) return "Not enough history for a forecast yet.";
  if (s.daysToWarn === 0) {
    return s.daysToFull != null
      ? `Already past ${WARN}%; at this rate it fills in about ${fmtDays(s.daysToFull)}.`
      : `Already past ${WARN}%, but usage isn't growing.`;
  }
  if (s.daysToWarn == null || s.daysToFull == null) return "Usage is flat over the last week.";
  return `At this rate the pool reaches ${WARN}% in about ${fmtDays(s.daysToWarn)} and fills in about ${fmtDays(s.daysToFull)}.`;
}

function weekly(perDay: number, du: DataUnit): string {
  const w = perDay * 7;
  return `${w < 0 ? "−" : "+"}${fmtBytes(Math.abs(w), 0, du)}`;
}

function demoInsight(): StorageInsight {
  const now = Date.now(), day = 86_400_000;
  const history = Array.from({ length: 31 }, (_, i) => ({ ts: now - (30 - i) * day, pct: Math.round((50.8 + i * 0.075 + Math.sin(i) * 0.05) * 10) / 10 }));
  const growthPerDay = 48e9 / 7;
  return {
    poolPct: 53.3, growthPerDay,
    daysToWarn: (18e12 * 0.85 - 9.6e12) / growthPerDay,
    daysToFull: 8.4e12 / growthPerDay,
    history,
    datasets: [
      { mountpoint: "/mnt/Pool/Media/TV",     growthPerDay: 31e9 / 7 },
      { mountpoint: "/mnt/Pool/Media/Movies", growthPerDay: 15e9 / 7 },
      { mountpoint: "/mnt/Pool/Media/Music",  growthPerDay: 2e9 / 7 },
    ],
    poolState: "online", arcHitPct: 97.2, arcSizeBytes: 31.8e9, timestamp: now,
  };
}

// 30 days of history on the left quarter, a 12-month straight-line projection
// on the rest: two time scales, labelled, so the projection has room.
function ForecastChart({ s }: { s: StorageInsight }) {
  const W = 300, H = 76, SPLIT = 0.25;
  const pts = s.history;
  const nowPct = s.poolPct ?? pts[pts.length - 1]?.pct ?? null;
  if (pts.length < 2 || nowPct == null) return null;

  const lo = Math.max(0, Math.floor((Math.min(...pts.map(p => p.pct), nowPct) - 10) / 10) * 10);
  const y = (p: number) => H - 2 - ((Math.min(100, p) - lo) / (100 - lo)) * (H - 4);
  const x0 = pts[0].ts, x1 = pts[pts.length - 1].ts;
  const px = (ts: number) => ((ts - x0) / Math.max(1, x1 - x0)) * W * SPLIT;

  const past = pts.map((p, i) => `${i ? "L" : "M"}${px(p.ts).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  const splitX = W * SPLIT;
  const fx = (days: number) => splitX + (Math.min(days, 365) / 365) * W * (1 - SPLIT);

  // Projection: rising until it reaches 100% (if within the year), then flat.
  let proj = `M${splitX},${y(nowPct).toFixed(1)}`;
  const perDayPct = s.growthPerDay != null && s.daysToFull != null && s.daysToFull > 0
    ? (100 - nowPct) / s.daysToFull : 0;
  if (perDayPct > 0 && s.daysToFull! < 365) {
    proj += ` L${fx(s.daysToFull!).toFixed(1)},${y(100).toFixed(1)} L${W},${y(100).toFixed(1)}`;
  } else {
    proj += ` L${W},${y(nowPct + perDayPct * 365).toFixed(1)}`;
  }

  const stroke = { fill: "none", stroke: "var(--accent-fs)", strokeWidth: 1.6, strokeLinejoin: "round" as const };
  const label: React.CSSProperties = { position: "absolute", fontSize: 12, color: "var(--text-ghost)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" };

  return (
    <div className="flex flex-col gap-1">
      <div className="relative" style={{ height: H }}>
        <svg role="img" aria-label="Pool usage over the last 30 days, and projected for the next 12 months"
          viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H, display: "block" }}>
          {WARN > lo && (
            <line x1={0} x2={W} y1={y(WARN)} y2={y(WARN)} vectorEffect="non-scaling-stroke"
              style={{ stroke: "var(--border-hover)", strokeWidth: 1, strokeDasharray: "3 4" }} />
          )}
          <line x1={splitX} x2={splitX} y1={0} y2={H} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--border-mid)", strokeWidth: 1 }} />
          <path d={`${past} L${px(x1).toFixed(1)},${H} L0,${H} Z`} style={{ fill: "color-mix(in srgb, var(--accent-fs) 18%, transparent)" }} />
          <path d={past} vectorEffect="non-scaling-stroke" style={stroke} />
          <path d={proj} vectorEffect="non-scaling-stroke" style={{ ...stroke, strokeDasharray: "4 4" }} />
        </svg>
        {WARN > lo && <span style={{ ...label, right: 0, top: Math.max(0, y(WARN) - 17) }}>{WARN}% warning</span>}
      </div>
      <div className="relative" style={{ height: 16 }}>
        <span style={{ ...label, left: 0 }}>−30 d</span>
        <span style={{ ...label, left: `${SPLIT * 100}%`, transform: "translateX(-50%)" }}>Now</span>
        <span style={{ ...label, right: 0 }}>+12 mo</span>
      </div>
    </div>
  );
}

export function FilesystemsBody({ metrics, du, fsPathPrefix }: {
  metrics: Metrics;
  du: DataUnit;
  fsPathPrefix: string;
}) {
  const [insight, setInsight] = useState<StorageInsight | null>(null);
  const demo = isDemoMode();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/storage", { cache: "no-store" });
      if (res.ok) setInsight(await res.json());
    } catch { /* keep the last one; the card still has the live numbers */ }
  }, []);
  usePollingInterval(load, 10 * 60_000, { enabled: !demo });
  const s = demo ? demoInsight() : insight;

  const folderName = (mp: string) => mp.startsWith(fsPathPrefix) ? mp.slice(fsPathPrefix.length) : (mp.split("/").pop() ?? mp);
  const sorted = [...metrics.disks].sort((a, b) => b.usedPct - a.usedPct);
  const growthOf = new Map((s?.datasets ?? []).map(d => [d.mountpoint, d.growthPerDay]));
  const poolUsed  = metrics.pool?.used  ?? null;
  const poolTotal = metrics.pool?.total ?? null;
  const poolPct   = poolTotal != null && poolUsed != null && poolTotal > 0 ? (poolUsed / poolTotal) * 100 : null;
  const poolColor = poolPct == null ? "var(--accent-fs)" : fsBarColor(poolPct);
  const poolOk = s?.poolState == null || s.poolState === "online";

  return (
    <div className="flex flex-col gap-3">
      {poolTotal != null && poolUsed != null && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="font-mono tabular-nums" style={{ fontSize: 26, fontWeight: 600, color: "var(--text)", lineHeight: 1.1, letterSpacing: "-0.01em" }}>
                {fmtBytes(poolUsed, 1, du)}
              </span>
              <span className="text-xs" style={{ color: "var(--text-label)" }}>of {fmtBytes(poolTotal, 1, du)}</span>
            </div>
            {poolPct != null && (
              <span className="font-mono tabular-nums" style={{ fontSize: 13, fontWeight: 600, color: poolColor }}>{poolPct.toFixed(0)}%</span>
            )}
          </div>
          <div className="rounded-full overflow-hidden" style={{ background: "var(--gauge-track)", height: 6 }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${poolPct ?? 0}%`, background: poolColor }} />
          </div>
          {s && (s.poolState != null || s.arcHitPct != null) && (
            <div className="flex flex-wrap items-center text-xs" style={{ columnGap: 6, rowGap: 2, color: "var(--text-faint)" }}>
              {s.poolState != null && (
                <span className="flex items-center gap-1.5" style={{ color: poolOk ? "var(--text-muted)" : "var(--critical)", fontWeight: poolOk ? 400 : 600 }}>
                  <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: poolOk ? "var(--ok)" : "var(--critical)" }} />
                  Pool {s.poolState}
                </span>
              )}
              {s.poolState != null && s.arcHitPct != null && <span aria-hidden="true">·</span>}
              {s.arcHitPct != null && (
                <span>ZFS cache hit rate <span className="font-mono tabular-nums" style={{ color: "var(--text-muted)" }}>{s.arcHitPct.toFixed(0)}%</span></span>
              )}
            </div>
          )}
        </div>
      )}

      {s && (s.history.length >= 2 || s.growthPerDay != null) && (
        <div className="flex flex-col gap-1.5" style={{ paddingTop: 10, borderTop: "1px solid var(--divider)" }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs" style={{ fontWeight: 600, color: "var(--text-dim)" }}>Fill-up forecast</span>
            {s.growthPerDay != null && (
              <span className="text-xs font-mono tabular-nums" style={{ color: "var(--text-muted)" }}>{weekly(s.growthPerDay, du)} a week</span>
            )}
          </div>
          <ForecastChart s={s} />
          <span className="text-xs" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>{forecastSentence(s)}</span>
        </div>
      )}

      <div className="flex flex-col" style={{
        overflowY: sorted.length > 4 ? "auto" : "visible",
        maxHeight: sorted.length > 4 ? 220 : undefined,
      }}>
        {sorted.map((disk, idx) => {
          const barC = fsBarColor(disk.usedPct);
          const g = growthOf.get(disk.mountpoint);
          return (
            <div key={disk.mountpoint} className="flex flex-col gap-1"
              style={{ padding: "5px 0", borderTop: idx > 0 ? "1px solid var(--border-dim)" : "none" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span aria-hidden="true" style={{ color: "var(--text-ghost)", flexShrink: 0, display: "inline-flex" }}><IconFolder /></span>
                  <span className="text-xs font-medium truncate" style={{ color: "var(--text-mid)" }}>{folderName(disk.mountpoint)}</span>
                  {g != null && Math.abs(g * 7) >= 1e8 && (
                    <span className="text-xs font-mono tabular-nums shrink-0" title="Growth over the last 7 days, per week" style={{ color: "var(--text-ghost)" }}>
                      {weekly(g, du)}/wk
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs tabular-nums font-mono" style={{ color: "var(--text-faint)" }}>{fmtBytes(disk.used, 1, du)}</span>
                  <span className="tabular-nums font-mono" style={{ fontSize: 12, fontWeight: 600, color: barC, minWidth: "2.5ch", textAlign: "right" }}>
                    {disk.usedPct.toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="rounded-full overflow-hidden" style={{ background: "var(--gauge-track)", height: 4 }}>
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${disk.usedPct}%`, background: barC }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
