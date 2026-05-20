// ── Formatting & color utilities ─────────────────────────────────────────────
// Pure functions — no React, no DOM, no side effects.

import type { DataUnit, TempUnit } from "@/app/lib/types";

export function fmtBytes(bytes: number | null, decimals = 1, unit: DataUnit = "decimal"): string {
  if (bytes === null || isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const k = unit === "binary" ? 1024 : 1000;
  const sizes = unit === "binary" ? ["B","KiB","MiB","GiB","TiB"] : ["B","KB","MB","GB","TB"];
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

export function fmtTemp(c: number | null, unit: TempUnit = "C"): string {
  if (c === null) return "—";
  if (unit === "F") return `${((c * 9 / 5) + 32).toFixed(0)}°F`;
  return `${c.toFixed(0)}°C`;
}

export function fmtUptime(s: number | null): string {
  if (s === null) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Smoothly bucketed "X ago" formatter — avoids twitchy 0s → 1s → 2s ticks
// in the UI. Used by anywhere that displays a poll's last-success timestamp.
// Buckets:
//   <5s    → "just now"
//   <60s   → rounded to nearest 5s
//   <60m   → rounded to nearest minute
//   <24h   → rounded to nearest hour
//   else   → days
export function fmtSmoothAgo(unixMs: number | null): string {
  if (unixMs == null) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - unixMs) / 1000));
  if (sec < 5)     return "just now";
  if (sec < 60)    return `${Math.round(sec / 5) * 5}s ago`;
  if (sec < 3600)  return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

// Color the "X ago" text by age — useful for "auto-tested X days ago" type
// displays so a stale-by-weeks indicator looks visibly stale at a glance.
// Returns a CSS color variable name.
export function ageColor(unixMs: number | null, opts?: { warnSec?: number; critSec?: number }): string {
  if (unixMs == null) return "var(--text-faint)";
  const age = (Date.now() - unixMs) / 1000;
  const warn = opts?.warnSec ?? 30 * 86400;   // default: amber after 30 days
  const crit = opts?.critSec ?? 180 * 86400;  // default: red after 180 days
  if (age >= crit) return "var(--critical)";
  if (age >= warn) return "var(--warn)";
  return "var(--text-faint)";
}

export function fmtSince(s: number | null): string {
  if (s === null) return "—";
  const b = new Date(Date.now() - s * 1000);
  const mo = b.toLocaleDateString(undefined, { month: "short" });
  return `${mo} ${b.getDate()} · ${String(b.getHours()).padStart(2, "0")}:${String(b.getMinutes()).padStart(2, "0")}`;
}

export function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

// Compact "time remaining" for queue items. qBit reports 8640000s (~100d)
// to mean "unknown", so we suppress anything that big.
export function fmtEtaShort(sec: number | null | undefined): string | null {
  if (sec == null || !isFinite(sec) || sec <= 0 || sec >= 8_640_000) return null;
  if (sec < 60)    return `${Math.round(sec)}s`;
  if (sec < 3600)  return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

export function cleanTitle(s: string): string {
  return s
    .replace(/\s*[\(\[]?(2160p|1080p|1080i|720p|480p|4K|UHD).*$/i, "")
    .replace(/\s*[\(\[]?(BluRay|BDRip|BRRip|WEB[\-\.]?DL|WEBRip|HDTV|DVDRip|HDRip|REMUX|PROPER|REPACK).*$/i, "")
    .replace(/\s*[\(\[]?(x264|x265|H\.26[45]|HEVC|AVC|AAC|AC3|DTS|Atmos|TrueHD).*$/i, "")
    .replace(/\.\w{2,4}$/, "")
    .replace(/\./g, " ")
    .trim();
}

export function pct(used: number | null, total: number | null): number {
  if (used === null || total === null || total === 0) return 0;
  return Math.min(100, (used / total) * 100);
}

// ── color helpers ────────────────────────────────────────────────────────────

export function barColor(p: number): string {
  if (p >= 90) return "var(--critical)";
  if (p >= 75) return "var(--warn)";
  if (p >= 50) return "var(--brand)";
  return "var(--ok)";
}

export function gpuUtilColor(p: number): string {
  if (p >= 90) return "var(--critical)";
  if (p >= 70) return "var(--warn)";
  return "var(--ok)";
}

export function tempColor(c: number): string {
  if (c >= 85) return "var(--critical)";
  if (c >= 70) return "var(--warn)";
  return "var(--ok)";
}

export function normalizeSpeedResult(r: import("@/app/lib/types").SpeedtestRaw): import("@/app/lib/types").SpeedtestResult {
  return {
    ping:           r.ping           ?? null,
    download:       r.download       ?? null,
    upload:         r.upload         ?? null,
    created_at:     r.created_at     ?? r.timestamp ?? null,
    timestamp:      r.timestamp      ?? r.created_at ?? null,
    jitter:         r.jitter         ?? null,
    isp:            r.isp            ?? r.server_name ?? null,
    serverName:     r.server_name    ?? r.isp ?? null,
    serverLocation: r.serverLocation ?? r.server_host ?? null,
    serverHost:     r.serverHost     ?? null,
  };
}

export const WEATHER_CODES: Record<number, string> = {
  0: "sunny", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "foggy", 48: "foggy",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "showers", 81: "rain showers", 82: "heavy showers",
  85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm", 99: "heavy thunderstorm",
};

// Small stat-history helper used by multiple card sections.
export function histStats(h: number[]) {
  if (!h.length) return { min: null as number | null, max: null as number | null, avg: null as number | null };
  return { min: Math.min(...h), max: Math.max(...h), avg: h.reduce((a, b) => a + b, 0) / h.length };
}
