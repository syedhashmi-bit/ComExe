"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { SmartDetail, SmartDisk, SmartFeed } from "@/app/lib/types";
import { usePollingInterval } from "@/app/hooks/usePolling";
import { isDemoMode } from "@/app/lib/demo-data";
import { fmtSmoothAgo, withAlpha } from "@/app/lib/formatters";
import { friendlyDriveName } from "@/app/lib/drive-names";

// Disk health as one table: every drive's temperature on a shared 20–80 °C
// scale with its warm and hot zones marked, its age, bad sectors and the last
// 24 hours. Drives with problems sort first, then the warmest. Click a drive
// for a week of temperatures and every SMART reading. Colour appears only when
// a drive is warm, hot, failing or has bad sectors. Data: /api/smart
// (smartmon.sh through node-exporter's textfile collector, plus node-exporter's
// own NVMe readings).

const SCALE_LO = 20, SCALE_HI = 80;
// The SMART script runs every 5 minutes; after this, say it seems to have stopped.
const STALE_MS = 30 * 60_000;

// Warm and hot from here. 3.5" disks are rated to ~60 °C but wear faster above
// ~50; NVMe drives start throttling in the 70s–80s.
export function tempLimits(kind: SmartDisk["kind"]): { warn: number; crit: number } {
  return kind === "nvme" ? { warn: 70, crit: 80 } : { warn: 50, crit: 55 };
}

export const scalePct = (t: number) =>
  ((Math.min(SCALE_HI, Math.max(SCALE_LO, t)) - SCALE_LO) / (SCALE_HI - SCALE_LO)) * 100;

// Total bad sectors and what they are. null when the drive reports none of
// the three counters (smartmon.sh gives NVMe drives none).
export function diskErrors(d: SmartDisk): { total: number | null; detail: string } {
  const parts: [string, number | null][] = [
    ["reallocated", d.reallocatedSectors], ["pending", d.pendingSectors], ["uncorrectable", d.uncorrectableSectors],
  ];
  const known = parts.filter(([, v]) => v != null) as [string, number][];
  if (known.length === 0) return { total: null, detail: "Not reported" };
  return { total: known.reduce((s, [, v]) => s + v, 0), detail: known.map(([k, v]) => `${v} ${k}`).join(" · ") };
}

// 0 failing or bad sectors · 1 hot · 2 warm · 3 fine.
export function diskRank(d: SmartDisk): number {
  const { warn, crit } = tempLimits(d.kind);
  if (!d.healthy || (diskErrors(d).total ?? 0) > 0) return 0;
  if (d.temperature != null && d.temperature >= crit) return 1;
  if (d.temperature != null && d.temperature >= warn) return 2;
  return 3;
}

// Problems first, then the warmest, then by name so equal drives stay put.
export function sortDisks(disks: SmartDisk[]): SmartDisk[] {
  return [...disks].sort((a, b) =>
    diskRank(a) - diskRank(b)
    || (b.temperature ?? -Infinity) - (a.temperature ?? -Infinity)
    || a.device.localeCompare(b.device));
}

export function fmtAge(hours: number): string {
  return hours >= 8760 ? `${(hours / 8760).toFixed(1)} years` : `${Math.round(hours / 24)} days`;
}

// SMART attribute names as smartmon writes them → readable labels.
const ATTR_LABELS: Record<string, string> = {
  raw_read_error_rate: "Read error rate", throughput_performance: "Throughput performance",
  spin_up_time: "Spin-up time", start_stop_count: "Start/stop count", reallocated_sector_ct: "Reallocated sectors",
  seek_error_rate: "Seek error rate", seek_time_performance: "Seek time performance", power_on_hours: "Power-on hours",
  spin_retry_count: "Spin retries", calibration_retry_count: "Calibration retries", power_cycle_count: "Power cycles",
  power_off_retract_count: "Power-off retracts", load_cycle_count: "Load cycles", temperature_celsius: "Temperature (°C)",
  reallocated_event_count: "Reallocation events", current_pending_sector: "Pending sectors",
  offline_uncorrectable: "Uncorrectable sectors", udma_crc_error_count: "Cable / interface errors",
  multi_zone_error_rate: "Write error rate", reported_uncorrect: "Reported uncorrectable", helium_level: "Helium level",
};
// Counters where anything above zero means trouble.
const BAD_IF_NONZERO = new Set([
  "reallocated_sector_ct", "current_pending_sector", "offline_uncorrectable", "reallocated_event_count",
  "reported_uncorrect", "spin_retry_count", "udma_crc_error_count",
]);
export const attrLabel = (name: string) =>
  ATTR_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, " ");

const KIND: Record<NonNullable<SmartDisk["kind"]>, string> = { nvme: "NVMe", sata: "SATA", sas: "SAS" };
const shortDev = (dev: string) => dev.replace(/^\/dev\//, "");
const NOT_REPORTED = "Not reported by this drive";

// ── Demo data (made after mount, never fetched) ─────────────────────────────

const wave = (n: number, base: number, swing: number, phase: number, period: number) =>
  Array.from({ length: n }, (_, i) => Math.round((base + swing * Math.sin((i + phase) / period) + 0.6 * Math.sin(i * 1.7)) * 10) / 10);

function demoFeed(): SmartFeed {
  const now = Date.now();
  const disk = (device: string, kind: SmartDisk["kind"], model: string, temperature: number, years: number | null, h: number[]): SmartDisk => ({
    device, kind, model, serial: "", temperature, healthy: true, history: h,
    powerOnHours: years != null ? Math.round(years * 8760) : null,
    reallocatedSectors: years != null ? 0 : null, pendingSectors: years != null ? 0 : null, uncorrectableSectors: years != null ? 0 : null,
  });
  return {
    timestamp: now, readAt: now - 2 * 60_000,
    disks: [
      disk("/dev/nvme0", "nvme", "CUSU CV3500Q 512GB", 31, null, wave(48, 31, 1.2, 2, 7.6)),
      disk("/dev/sda", "sata", "WDC WD60PURZ-85ZUFY1", 42, 5.1, wave(48, 41, 2.2, 0, 7.6)),
      disk("/dev/sdb", "sata", "WDC WD40EFPX-68C6CN0", 41, 1.6, wave(48, 40, 2, 3, 7.6)),
      disk("/dev/sdc", "sata", "WDC WD80EFAX-68KNBN0", 46, 7.1, wave(48, 45, 2.4, 1, 7.6)),
      disk("/dev/sdd", "sata", "WDC WD40EFPX-68C6CN0", 40, 1.8, wave(48, 39, 2, 4, 7.6)),
    ],
  };
}

function demoDetail(d: SmartDisk): SmartDetail {
  const now = Date.now();
  const temps = wave(84, d.temperature ?? 40, 2.4, 3, 6);
  const hours = d.powerOnHours ?? 0;
  const attrs: [number, string, number][] = d.kind === "nvme" ? [] : [
    [1, "raw_read_error_rate", 0], [3, "spin_up_time", 5891], [4, "start_stop_count", 214],
    [5, "reallocated_sector_ct", 0], [7, "seek_error_rate", 0], [9, "power_on_hours", hours],
    [10, "spin_retry_count", 0], [11, "calibration_retry_count", 0], [12, "power_cycle_count", 96],
    [192, "power_off_retract_count", 61], [193, "load_cycle_count", 1840], [194, "temperature_celsius", d.temperature ?? 0],
    [196, "reallocated_event_count", 0], [197, "current_pending_sector", 0], [198, "offline_uncorrectable", 0],
    [199, "udma_crc_error_count", 0], [200, "multi_zone_error_rate", 0],
  ];
  return {
    device: d.device, firmware: d.kind === "nvme" ? "SN24737" : "82.00A82", serial: null,
    attributes: attrs.map(([id, name, value]) => ({ id, name, value })),
    history: temps.map((value, i) => ({ ts: now - (83 - i) * 7_200_000, value })),
  };
}

// ── Pieces ──────────────────────────────────────────────────────────────────

// Remembers "Hide" on the not-set-up hint. Only that hint: once the exporter
// reports disks the panel shows again regardless.
const HINT_KEY = "comexe:smart-hint-hidden";

function readHintHidden(): boolean {
  try { return typeof window !== "undefined" && localStorage.getItem(HINT_KEY) === "1"; }
  catch { return false; }
}

// The panel draws its own card, so the not-set-up state can be a slim strip
// (or nothing) instead of a full-width card announcing an absence.
function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
      {children}
    </div>
  );
}

const dash = <span title={NOT_REPORTED} style={{ fontSize: 13, color: "var(--text-ghost)" }}>—</span>;

function TempCell({ d }: { d: SmartDisk }) {
  if (d.temperature == null) return dash;
  const { warn, crit } = tempLimits(d.kind);
  const t = d.temperature;
  const status = t >= crit ? "var(--critical)" : t >= warn ? "var(--warn)" : null;
  return (
    <div className="flex items-center" style={{ gap: 12, minWidth: 0 }}>
      <span className="font-mono shrink-0" style={{ width: 52, fontSize: 13, color: status ?? "var(--text)", fontWeight: status ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
        {t} °C
      </span>
      <div role="img" aria-label={`${t} °C; warm from ${warn} °C, hot from ${crit} °C`}
        style={{ position: "relative", flex: 1, minWidth: 60, height: 6, borderRadius: 3, background: "var(--gauge-track)" }}>
        <span style={{ position: "absolute", top: 0, bottom: 0, left: `${scalePct(warn)}%`, width: `${scalePct(crit) - scalePct(warn)}%`, background: withAlpha("var(--warn)", 35) }} />
        <span style={{ position: "absolute", top: 0, bottom: 0, left: `${scalePct(crit)}%`, right: 0, borderRadius: "0 3px 3px 0", background: withAlpha("var(--critical)", 35) }} />
        <span style={{
          position: "absolute", top: "50%", left: `${scalePct(t)}%`, width: 10, height: 10, borderRadius: 5,
          transform: "translate(-50%, -50%)", background: status ?? "var(--accent-fs)", border: "2px solid var(--card)",
        }} />
      </div>
    </div>
  );
}

function SparkCell({ d }: { d: SmartDisk }) {
  const h = d.history;
  if (h.length < 2) return dash;
  const min = Math.min(...h), max = Math.max(...h);
  const lo = min - 1.5, hi = max + 1.5;
  const line = h.map((v, i) => `${i ? "L" : "M"}${((i / (h.length - 1)) * 100).toFixed(1)},${(26 - ((v - lo) / (hi - lo)) * 24).toFixed(1)}`).join(" ");
  const range = `${Math.round(min)}–${Math.round(max)} °C`;
  return (
    <div className="flex items-center" style={{ gap: 10 }}>
      <svg role="img" aria-label={`${shortDev(d.device)} over the last 24 hours: ${range}`}
        viewBox="0 0 100 28" preserveAspectRatio="none" style={{ width: 90, height: 28, display: "block", flexShrink: 0 }}>
        <path d={`${line} L100,28 L0,28 Z`} style={{ fill: withAlpha("var(--accent-fs)", 16) }} />
        <path d={line} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: "var(--accent-fs)", strokeWidth: 1.5, strokeLinejoin: "round" }} />
      </svg>
      <span className="font-mono" style={{ fontSize: 12, color: "var(--text-faint)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{range}</span>
    </div>
  );
}

// A week of temperatures with a hover readout.
function WeekChart({ points, kind }: { points: { ts: number; value: number }[]; kind: SmartDisk["kind"] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) {
    return <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Not enough history yet: readings started recently.</span>;
  }
  const W = 400, H = 110;
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals), avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const lo = Math.floor(min - 2), hi = Math.ceil(max + 2);
  const t0 = points[0].ts, t1 = points[points.length - 1].ts;
  const x = (ts: number) => ((ts - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const { warn } = tempLimits(kind);
  const p = hover != null ? points[hover] : null;
  const pos = p ? (x(p.ts) / W) * 100 : 0;
  const days = Math.max(1, Math.round((t1 - t0) / 86_400_000));
  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <div className="flex items-baseline justify-between" style={{ fontSize: 12 }}>
        <span style={{ fontWeight: 600, color: "var(--text-dim)" }}>Last {days === 1 ? "day" : `${days} days`}</span>
        <span className="font-mono" style={{ color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
          min {Math.round(min)} · avg {Math.round(avg)} · max {Math.round(max)} °C
        </span>
      </div>
      <div className="relative" style={{ height: H }}
        onMouseMove={e => {
          const b = e.currentTarget.getBoundingClientRect();
          const ts = t0 + ((e.clientX - b.left) / b.width) * (t1 - t0);
          let best = 0;
          points.forEach((q, i) => { if (Math.abs(q.ts - ts) < Math.abs(points[best].ts - ts)) best = i; });
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}>
        <svg role="img" aria-label={`Temperature over the last ${days} days: ${Math.round(min)} to ${Math.round(max)} °C`}
          viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }}>
          {warn > lo && warn < hi && (
            <line x1={0} x2={W} y1={y(warn)} y2={y(warn)} vectorEffect="non-scaling-stroke" style={{ stroke: withAlpha("var(--warn)", 60), strokeWidth: 1, strokeDasharray: "3 4" }} />
          )}
          <path d={`${line} L${W},${H} L0,${H} Z`} style={{ fill: withAlpha("var(--accent-fs)", 16) }} />
          <path d={line} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: "var(--accent-fs)", strokeWidth: 1.5, strokeLinejoin: "round" }} />
        </svg>
        {p && (
          <>
            <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: `${pos}%`, width: 1, background: "var(--border-hover)", pointerEvents: "none" }} />
            <div style={{
              position: "absolute", top: 4, pointerEvents: "none",
              ...(pos > 55 ? { right: `calc(${100 - pos}% + 8px)` } : { left: `calc(${pos}% + 8px)` }),
              padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--border-mid)", borderRadius: 6,
              fontSize: 12, fontFamily: "var(--font-mono)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
            }}>
              <span style={{ color: "var(--text-faint)" }}>{new Date(p.ts).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
              <span style={{ color: "var(--text)" }}> · {p.value} °C</span>
            </div>
          </>
        )}
      </div>
      <div className="flex justify-between" style={{ fontSize: 12, color: "var(--text-ghost)", fontFamily: "var(--font-mono)" }}>
        <span>{days} {days === 1 ? "day" : "days"} ago</span><span>Now</span>
      </div>
    </div>
  );
}

function DiskDetail({ d }: { d: SmartDisk }) {
  const [detail, setDetail] = useState<SmartDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (isDemoMode()) { Promise.resolve(demoDetail(d)).then(x => { if (!cancelled) setDetail(x); }); return () => { cancelled = true; }; }
    fetch(`/api/smart?device=${encodeURIComponent(d.device)}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((x: SmartDetail) => { if (!cancelled) setDetail(x); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [d]);

  const raw = d.model;
  const friendly = friendlyDriveName(raw);
  return (
    <div id={`disk-detail-${shortDev(d.device)}`} className="flex flex-wrap"
      style={{ gap: 20, padding: "12px 0 16px", borderBottom: "1px solid var(--border-dim)" }}>
      {failed ? (
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Couldn&apos;t load this drive&apos;s detail.</span>
      ) : !detail ? (
        <div className="skeleton rounded" style={{ height: 120, flex: "1 1 100%" }} />
      ) : (
        <>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <WeekChart points={detail.history} kind={d.kind} />
          </div>
          <div className="flex flex-col" style={{ flex: "1 1 260px", minWidth: 0, gap: 8 }}>
            <div className="flex flex-col" style={{ gap: 2, fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: "var(--text-dim)" }}>{friendly ?? raw}</span>
              <span className="font-mono" style={{ color: "var(--text-faint)" }}>
                {[friendly ? raw : null, detail.serial ?? d.serial ?? null, detail.firmware ? `firmware ${detail.firmware}` : null].filter(Boolean).join(" · ")}
              </span>
            </div>
            {detail.attributes.length === 0 ? (
              <span style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 }}>
                This drive reports only whether it&apos;s healthy, no SMART counters. Its temperature comes from the kernel&apos;s sensor.
              </span>
            ) : (
              <dl className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 16, rowGap: 3, margin: 0, fontSize: 12 }}>
                {detail.attributes.map(a => {
                  const bad = BAD_IF_NONZERO.has(a.name) && a.value > 0;
                  return (
                    <div key={`${a.id}-${a.name}`} style={{ display: "contents" }}>
                      <dt title={a.id != null ? `SMART attribute ${a.id}` : undefined} style={{ color: bad ? "var(--critical)" : "var(--text-faint)" }}>{attrLabel(a.name)}</dt>
                      <dd className="font-mono" style={{ margin: 0, textAlign: "right", color: bad ? "var(--critical)" : "var(--text-muted)", fontWeight: bad ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
                        {Number.isInteger(a.value) ? a.value.toLocaleString() : a.value}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

export function DiskHealthPanel() {
  const [feed, setFeed] = useState<SmartFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Any number of drives can be open at once.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // Safe to read in the initializer: the first render is always the loading
  // state, which doesn't depend on it, so server and client markup match.
  const [hintHidden, setHintHidden] = useState(readHintHidden);

  function hideHint() {
    setHintHidden(true);
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* private mode etc. */ }
  }
  const toggle = (dev: string) => setOpen(prev => {
    const next = new Set(prev);
    if (!next.delete(dev)) next.add(dev);
    return next;
  });

  // Demo data arrives the same way as real data, after mount — /api/smart
  // queries Prometheus, and demo mode makes no upstream calls.
  const load = useCallback(async () => {
    if (isDemoMode()) { setFeed(demoFeed()); return; }
    try {
      const res = await fetch("/api/smart");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFeed(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  usePollingInterval(load, 60_000);

  // Nothing while the first fetch runs: most installs have no exporter, and a
  // card that appears only to shrink into a one-line hint is worse than a beat
  // of empty space below the fold.
  if (!feed && !error) return null;
  const disks = sortDisks(feed?.disks ?? []);

  if (error || disks.length === 0) {
    if (!error && hintHidden) return null;
    return (
      <div className="flex items-center gap-2" style={{
        border: "1px dashed var(--border)", borderRadius: 10, padding: "7px 14px",
        fontSize: 12, color: "var(--text-label)", minWidth: 0,
      }}>
        <svg className="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
          <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
        </svg>
        <span className="shrink-0" style={{ color: "var(--text-secondary)", fontWeight: 600 }}>Disk health</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-ghost)" }}>
          {error
            ? `unavailable · ${error}`
            : "not set up · add the smartmon script to node-exporter to see disk temperatures and errors (INSTALL.md → Disk health)"}
        </span>
        {!error && (
          <button onClick={hideHint} className="shrink-0" style={{
            marginLeft: "auto", fontSize: 12, color: "var(--text-label)", background: "none",
            border: "1px solid var(--border)", borderRadius: 5, padding: "2px 8px", cursor: "pointer",
          }}>Hide</button>
        )}
      </div>
    );
  }

  const failing = disks.filter(d => !d.healthy);
  const withTemp = disks.filter(d => d.temperature != null);
  const warmest = withTemp.length ? withTemp.reduce((a, b) => (b.temperature! > a.temperature! ? b : a)) : null;
  const aged = disks.filter(d => d.powerOnHours != null);
  const oldest = aged.length ? aged.reduce((a, b) => (b.powerOnHours! > a.powerOnHours! ? b : a)) : null;
  const readAt = feed?.readAt ?? null;
  const stale = readAt != null && (feed?.timestamp ?? 0) - readAt > STALE_MS;
  const summary = [
    warmest ? `Warmest ${shortDev(warmest.device)} ${warmest.temperature} °C` : null,
    oldest ? `oldest ${shortDev(oldest.device)} ${fmtAge(oldest.powerOnHours!)}` : null,
    readAt != null && !stale ? `read ${fmtSmoothAgo(readAt)}` : null,
  ].filter(Boolean).join(" · ");

  const head: React.CSSProperties = { fontSize: 12, color: "var(--text-ghost)" };

  return (
    <Frame>
    <div className="flex flex-col" style={{ gap: 12 }}>
      <div className="flex flex-wrap items-center" style={{ columnGap: 12, rowGap: 4 }}>
        <span className="flex items-center gap-2">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-fs)" }}>
            <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Disk health</span>
        </span>
        <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: failing.length ? "var(--critical)" : "var(--text-muted)", fontWeight: failing.length ? 600 : 400 }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: failing.length ? "var(--critical)" : "var(--ok)" }} />
          {failing.length
            ? `${failing.length} failing SMART: ${failing.map(d => shortDev(d.device)).join(", ")}`
            : `All ${disks.length} healthy`}
        </span>
        {summary && <span className="ml-auto" style={{ fontSize: 12, color: "var(--text-faint)" }}>{summary}</span>}
      </div>

      {stale && (
        <span style={{ fontSize: 12, color: "var(--warn)" }}>
          Last read {fmtSmoothAgo(readAt)} — the SMART cron job may have stopped, so these readings are old.
        </span>
      )}

      <div className="disk-table" role="table" aria-label="Disk health">
        <div className="disk-row" role="row" style={{ paddingBottom: 6, borderBottom: "1px solid var(--divider)" }}>
          <span role="columnheader" style={head}>Drive</span>
          <span role="columnheader" style={head}>Temperature <span style={{ color: "var(--text-ghost)" }}>· {SCALE_LO}–{SCALE_HI} °C</span></span>
          <span role="columnheader" className="disk-col-age" style={head}>Age</span>
          <span role="columnheader" style={head}>Bad sectors</span>
          <span role="columnheader" className="disk-col-spark" style={head}>Last 24 h</span>
        </div>
        {disks.map(d => {
          const err = diskErrors(d);
          const isOpen = open.has(d.device);
          const friendly = friendlyDriveName(d.model);
          return (
            <div key={d.device} role="rowgroup">
              <div className="disk-row disk-row-click" role="row" onClick={() => toggle(d.device)}
                style={{ minHeight: 56, padding: "8px 0", borderBottom: isOpen ? "none" : "1px solid var(--border-dim)", cursor: "pointer" }}>
                <div role="cell" className="flex flex-col" style={{ gap: 2, minWidth: 0 }}>
                  <span className="flex items-center" style={{ gap: 8 }}>
                    <button type="button" aria-expanded={isOpen} aria-controls={`disk-detail-${shortDev(d.device)}`}
                      aria-label={`${shortDev(d.device)} details`}
                      onClick={e => { e.stopPropagation(); toggle(d.device); }}
                      className="flex items-center font-mono"
                      style={{ gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
                      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ color: "var(--text-ghost)", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                      {shortDev(d.device)}
                    </button>
                    {d.kind && <span style={{ fontSize: 12, color: "var(--text-faint)", border: "1px solid var(--border)", borderRadius: 4, padding: "0 5px" }}>{KIND[d.kind]}</span>}
                    {!d.healthy && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--critical)" }}>Failing</span>}
                  </span>
                  <span className="truncate" title={[d.model, d.serial].filter(Boolean).join(" · ")} style={{ fontSize: 12, color: "var(--text-faint)", paddingLeft: 16 }}>
                    {friendly ?? d.model}
                  </span>
                </div>
                <div role="cell" style={{ minWidth: 0 }}><TempCell d={d} /></div>
                <div role="cell" className="disk-col-age flex flex-col" style={{ gap: 2 }}>
                  {d.powerOnHours != null ? (
                    <>
                      <span className="font-mono" style={{ fontSize: 13, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmtAge(d.powerOnHours)}</span>
                      <span className="font-mono" style={{ fontSize: 12, color: "var(--text-ghost)", fontVariantNumeric: "tabular-nums" }}>{Math.round(d.powerOnHours).toLocaleString()} h</span>
                    </>
                  ) : dash}
                </div>
                <div role="cell" title={err.total == null ? NOT_REPORTED : err.detail}>
                  {err.total == null ? dash : err.total === 0 ? (
                    <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--text-faint)" }}>
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      None
                    </span>
                  ) : (
                    <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--critical)", fontVariantNumeric: "tabular-nums" }}>
                      {err.total} bad sector{err.total === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div role="cell" className="disk-col-spark"><SparkCell d={d} /></div>
              </div>
              {isOpen && <DiskDetail d={d} />}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center" style={{ columnGap: 16, rowGap: 4, fontSize: 12, color: "var(--text-ghost)" }}>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" style={{ width: 14, height: 6, borderRadius: 2, background: withAlpha("var(--warn)", 35) }} />Warm from 50 °C (disks), 70 °C (NVMe)</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" style={{ width: 14, height: 6, borderRadius: 2, background: withAlpha("var(--critical)", 35) }} />Hot from 55 °C (disks), 80 °C (NVMe)</span>
        <span className="ml-auto">Click a drive for its week and every SMART reading</span>
      </div>
    </div>
    </Frame>
  );
}
