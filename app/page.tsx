"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

const MAX_HISTORY = 30;

// ── types ─────────────────────────────────────────────────────────────────────

type AlertLevel   = "warning" | "critical" | null;
type HealthStatus = "healthy" | "warning" | "critical";
type TempUnit     = "C" | "F";
type DataUnit     = "decimal" | "binary";

interface HealthResult { status: HealthStatus; reason: string }

interface DiskEntry {
  mountpoint: string; device: string; fstype: string;
  total: number; avail: number; used: number; usedPct: number;
}

interface Metrics {
  cpu: number | null;
  memory: { total: number | null; used: number | null; available: number | null; sReclaimable: number | null };
  uptime: number | null;
  disks: DiskEntry[];
  network: {
    rxBytesPerSec: number | null; txBytesPerSec: number | null;
    rxBytesTotal:  number | null; txBytesTotal:  number | null;
    interfaceName?: string | null;
  };
  gpu: {
    name: string | null;
    utilization: number | null;
    memUsed: number | null; memTotal: number | null;
    temperature: number | null;
    powerDraw: number | null; powerLimit: number | null;
  };
  sysInfo?: {
    os: string | null;
    kernel: string | null;
    arch: string | null;
    hostname: string | null;
    cpuCores: number | null;
  };
  timestamp: number;
}

interface Settings {
  refreshInterval: number;
  tempUnit: TempUnit;
  dataUnit: DataUnit;
  visibleCards: Record<string, boolean>;
}

interface SpeedtestResult {
  ping:           number | null;
  download:       number | null;
  upload:         number | null;
  created_at:     string | null;
  isp:            string | null;
  jitter:         number | null;
  serverName:     string | null;
  serverLocation: string | null;
}

interface ServiceResult {
  name: string;
  up: boolean;
  lines: string[];
  pct?: number;
  downCount?: number;
}

// ── module constants ──────────────────────────────────────────────────────────

const SVC_COLORS: Record<string, string> = {
  radarr: "#f5c518", sonarr: "#35c5f4", bazarr: "#4a90d9",
  tautulli: "#e5a00d", qbittorrent: "#2196f3", overseerr: "#e5a00d",
  pihole: "#f60d1a", prowlarr: "#ff8c00", nginx: "#2ecc71",
  uptimekuma: "#5cdd8b",
};
const SVC_ICONS: Record<string, string> = {
  radarr:      "https://www.google.com/s2/favicons?domain=radarr.video&sz=32",
  sonarr:      "https://www.google.com/s2/favicons?domain=sonarr.tv&sz=32",
  bazarr:      "https://www.google.com/s2/favicons?domain=bazarr.media&sz=32",
  tautulli:    "https://www.google.com/s2/favicons?domain=tautulli.com&sz=32",
  qbittorrent: "https://www.google.com/s2/favicons?domain=qbittorrent.org&sz=32",
  overseerr:   "https://www.google.com/s2/favicons?domain=overseerr.dev&sz=32",
  nginx:       "https://www.google.com/s2/favicons?domain=nginxproxymanager.com&sz=32",
  pihole:      "https://www.google.com/s2/favicons?domain=pi-hole.net&sz=32",
  prowlarr:    "https://www.google.com/s2/favicons?domain=prowlarr.com&sz=32",
  uptimekuma:  "https://www.google.com/s2/favicons?domain=uptime.kuma.pet&sz=32",
};
const SVC_URLS: Record<string, string> = {
  radarr:      "http://192.168.88.196:30025",
  sonarr:      "http://192.168.88.196:33027",
  bazarr:      "http://192.168.88.196:30046",
  tautulli:    "http://192.168.88.196:30047",
  qbittorrent: "http://192.168.88.196:30024",
  overseerr:   "http://192.168.88.196:30002",
  nginx:       "http://192.168.88.196:30020",
  pihole:      "http://192.168.88.196:20720",
  prowlarr:    "http://192.168.88.196:30050",
  uptimekuma:  "http://192.168.88.196:31050",
};
const SVC_LABELS: Record<string, string> = {
  qbittorrent: "qBittorrent",
  nginx:       "Nginx Proxy",
  uptimekuma:  "Uptime Kuma",
};

const BOOKMARKS: { title: string; accentColor: string; items: { name: string; url: string; icon: string }[] }[] = [
  {
    title: "Social",
    accentColor: "#06b6d4",
    items: [
      { name: "YouTube",     url: "https://www.youtube.com",    icon: "https://www.google.com/s2/favicons?domain=youtube.com&sz=32" },
      { name: "Facebook",    url: "https://www.facebook.com",   icon: "https://www.google.com/s2/favicons?domain=facebook.com&sz=32" },
      { name: "Instagram",   url: "https://www.instagram.com",  icon: "https://www.google.com/s2/favicons?domain=instagram.com&sz=32" },
      { name: "Reddit",      url: "https://www.reddit.com",     icon: "https://www.google.com/s2/favicons?domain=reddit.com&sz=32" },
      { name: "Twitter / X", url: "https://x.com",             icon: "https://www.google.com/s2/favicons?domain=x.com&sz=32" },
    ],
  },
  {
    title: "Productivity",
    accentColor: "#10b981",
    items: [
      { name: "ChatGPT",     url: "https://chatgpt.com",                   icon: "https://www.google.com/s2/favicons?domain=chatgpt.com&sz=32" },
      { name: "OpenwebUI",   url: "http://192.168.88.196",                 icon: "https://www.google.com/s2/favicons?domain=openwebui.com&sz=32" },
      { name: "Gmail",       url: "https://mail.google.com",               icon: "https://www.google.com/s2/favicons?domain=gmail.com&sz=32" },
      { name: "Outlook",     url: "https://outlook.live.com",              icon: "https://www.google.com/s2/favicons?domain=outlook.com&sz=32" },
      { name: "Confluence",  url: "https://syedhashme.atlassian.net",      icon: "https://www.google.com/s2/favicons?domain=atlassian.net&sz=32" },
      { name: "Bitdefender", url: "https://central.bitdefender.com",       icon: "https://www.google.com/s2/favicons?domain=bitdefender.com&sz=32" },
      { name: "Coursera",    url: "https://www.coursera.org",              icon: "https://www.google.com/s2/favicons?domain=coursera.org&sz=32" },
      { name: "LinkedIn",    url: "https://www.linkedin.com",              icon: "https://www.google.com/s2/favicons?domain=linkedin.com&sz=32" },
    ],
  },
  {
    title: "Entertainment",
    accentColor: "#f59e0b",
    items: [
      { name: "Plex",        url: "https://app.plex.tv",                   icon: "https://www.google.com/s2/favicons?domain=plex.tv&sz=32" },
      { name: "Overseerr",   url: "http://192.168.88.196:30002",           icon: SVC_ICONS.overseerr },
      { name: "Tautulli",    url: "http://192.168.88.196:30047",           icon: SVC_ICONS.tautulli },
      { name: "Radarr",      url: "http://192.168.88.196:30025",           icon: SVC_ICONS.radarr },
      { name: "Sonarr",      url: "http://192.168.88.196:33027",           icon: SVC_ICONS.sonarr },
      { name: "Bazarr",      url: "http://192.168.88.196:30046",           icon: SVC_ICONS.bazarr },
      { name: "Cleanuparr",  url: "http://192.168.88.196",                 icon: "https://www.google.com/s2/favicons?domain=cleanuparr.com&sz=32" },
    ],
  },
  {
    title: "NaServer",
    accentColor: "#8b5cf6",
    items: [
      { name: "TrueNAS",        url: "http://192.168.88.196",              icon: "https://www.google.com/s2/favicons?domain=truenas.com&sz=32" },
      { name: "Glances",        url: "http://192.168.88.196:30015",        icon: "https://www.google.com/s2/favicons?domain=nicolargo.github.io&sz=32" },
      { name: "qBittorrent",    url: "http://192.168.88.196:30024",        icon: SVC_ICONS.qbittorrent },
      { name: "Open-Speedtest", url: "http://192.168.88.196:30220",        icon: "https://www.google.com/s2/favicons?domain=openspeedtest.com&sz=32" },
      { name: "PiHole",         url: "http://192.168.88.196:20720",        icon: SVC_ICONS.pihole },
      { name: "Uptime-Kuma",    url: "http://192.168.88.196:31050",        icon: "https://www.google.com/s2/favicons?domain=uptime.kuma.pet&sz=32" },
      { name: "JDownloader",    url: "https://my.jdownloader.org",         icon: "https://www.google.com/s2/favicons?domain=jdownloader.org&sz=32" },
    ],
  },
];

// ── client-side data fetching ─────────────────────────────────────────────────

const PROMETHEUS    = "http://192.168.88.196:30104";
const SPEEDTEST_BASE = "http://192.168.88.196:30220";
const WEATHER_URL   = "https://api.open-meteo.com/v1/forecast?latitude=-41.4419&longitude=147.1450&current=temperature_2m,weather_code";
const FS_EXCLUDE    = `fstype!~"tmpfs|devtmpfs|overlay|squashfs|ramfs"`;

const WEATHER_CODES: Record<number, string> = {
  0: "sunny", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "foggy", 48: "foggy",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "showers", 81: "rain showers", 82: "heavy showers",
  85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm", 99: "heavy thunderstorm",
};

async function queryProm(q: string): Promise<number | null> {
  try {
    const res = await fetch(`${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.data?.result?.[0]?.value?.[1];
    return result != null ? parseFloat(result) : null;
  } catch {
    return null;
  }
}

async function queryPromAll(q: string): Promise<{ metric: Record<string, string>; value: number }[]> {
  try {
    const res = await fetch(`${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.data?.result ?? []).map((r: { metric: Record<string, string>; value: [number, string] }) => ({
      metric: r.metric,
      value:  parseFloat(r.value[1]),
    }));
  } catch {
    return [];
  }
}

function fmtMB(b: number): string {
  if (b === 0) return "0 B";
  if (b < 1e6) return `${(b / 1e3).toFixed(0)} KB`;
  if (b < 1e9) return `${(b / 1e6).toFixed(0)} MB`;
  return `${(b / 1e9).toFixed(1)} GB`;
}

async function svcFetch(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function checkReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

async function radarrSvc(): Promise<ServiceResult> {
  try {
    const data = await svcFetch(
      "http://192.168.88.196:30025/api/v3/movie?apiKey=***REMOVED***"
    ) as { hasFile: boolean; monitored: boolean }[];
    const total   = data.length;
    const missing = data.filter(m => !m.hasFile && m.monitored).length;
    const p       = total > 0 ? Math.round(((total - missing) / total) * 100) : 100;
    return { name: "radarr", up: true, pct: p, lines: [`${total} movies · ${missing} missing`, `${p}% complete`] };
  } catch {
    const up = await checkReachable("http://192.168.88.196:30025");
    return { name: "radarr", up, lines: up ? ["—"] : [] };
  }
}

async function sonarrSvc(): Promise<ServiceResult> {
  try {
    const [seriesData, wantedData, queueData] = await Promise.all([
      svcFetch("http://192.168.88.196:33027/api/v3/series?apiKey=***REMOVED***") as Promise<{ monitored: boolean }[]>,
      svcFetch("http://192.168.88.196:33027/api/v3/wanted/missing?apiKey=***REMOVED***&pageSize=1") as Promise<{ totalRecords: number }>,
      svcFetch("http://192.168.88.196:33027/api/v3/queue?apiKey=***REMOVED***&pageSize=1") as Promise<{ totalRecords: number }>,
    ]);
    const total   = seriesData.length;
    const missing = wantedData.totalRecords ?? 0;
    const queue   = queueData.totalRecords ?? 0;
    const lines   = [`${total} series · ${missing} missing eps`];
    if (queue > 0) lines.push(`+${queue} downloading`);
    return { name: "sonarr", up: true, lines };
  } catch {
    const up = await checkReachable("http://192.168.88.196:33027");
    return { name: "sonarr", up, lines: up ? ["—"] : [] };
  }
}

async function bazarrSvc(): Promise<ServiceResult> {
  try {
    const [epData, mvData] = await Promise.all([
      svcFetch("http://192.168.88.196:30046/api/episodes/wanted?apiKey=***REMOVED***&start=0&length=1") as Promise<{ data: { total: number } }>,
      svcFetch("http://192.168.88.196:30046/api/movies/wanted?apiKey=***REMOVED***&start=0&length=1") as Promise<{ data: { total: number } }>,
    ]);
    const epMissing = epData?.data?.total ?? 0;
    const mvMissing = mvData?.data?.total ?? 0;
    return { name: "bazarr", up: true, lines: [`${epMissing} ep subs · ${mvMissing} movie subs`] };
  } catch {
    const up = await checkReachable("http://192.168.88.196:30046");
    return { name: "bazarr", up, lines: up ? ["—"] : [] };
  }
}

async function tautulliSvc(): Promise<ServiceResult> {
  try {
    const data = await svcFetch(
      "http://192.168.88.196:30047/api/v2?apikey=***REMOVED***&cmd=get_activity"
    ) as { response: { data: { stream_count: string } } };
    const count = parseInt(data?.response?.data?.stream_count ?? "0", 10);
    return { name: "tautulli", up: true, lines: [count > 0 ? `${count} active stream${count !== 1 ? "s" : ""}` : "no active streams"] };
  } catch {
    const up = await checkReachable("http://192.168.88.196:30047");
    return { name: "tautulli", up, lines: up ? ["—"] : [] };
  }
}

async function qbittorrentSvc(): Promise<ServiceResult> {
  try {
    const data = await svcFetch("http://192.168.88.196:30024/api/v2/torrents/info") as { state: string; dlspeed?: number; size?: number }[];
    const dlStates    = new Set(["downloading","stalledDL","checkingDL","pausedDL","forcedDL","metaDL"]);
    const seedStates  = new Set(["uploading","stalledUP","checkingUP","pausedUP","forcedUP","seeding"]);
    const total       = data.length;
    const downloading = data.filter(t => dlStates.has(t.state)).length;
    const seeding     = data.filter(t => seedStates.has(t.state)).length;
    const totalSize   = data.reduce((s, t) => s + (t.size     ?? 0), 0);
    const dlSpeed     = data.reduce((s, t) => s + (t.dlspeed  ?? 0), 0);
    const lines = [`${total} total · ${downloading} dl · ${seeding} seed`];
    if (totalSize > 0) lines.push(`${fmtMB(totalSize)} total`);
    if (dlSpeed   > 0) lines.push(`${fmtMB(dlSpeed)}/s`);
    return { name: "qbittorrent", up: true, lines };
  } catch {
    const up = await checkReachable("http://192.168.88.196:30024/api/v2/app/version");
    return { name: "qbittorrent", up, lines: up ? ["—"] : [] };
  }
}

async function overseerrSvc(): Promise<ServiceResult> {
  const KEY = "***REMOVED***";
  try {
    const [pendingData, approvedData, availableData] = await Promise.all([
      svcFetch("http://192.168.88.196:30002/api/v1/request?take=1&skip=0&filter=pending",   { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>,
      svcFetch("http://192.168.88.196:30002/api/v1/request?take=1&skip=0&filter=approved",  { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>,
      svcFetch("http://192.168.88.196:30002/api/v1/request?take=1&skip=0&filter=available", { "X-Api-Key": KEY }) as Promise<{ pageInfo: { results: number } }>,
    ]);
    const pending   = pendingData.pageInfo?.results   ?? 0;
    const approved  = approvedData.pageInfo?.results  ?? 0;
    const available = availableData.pageInfo?.results ?? 0;
    const lines = [`${pending} pending · ${approved} approved`];
    if (available > 0) lines.push(`${available} available`);
    return { name: "overseerr", up: true, lines };
  } catch {
    const up = await checkReachable("http://192.168.88.196:30002");
    return { name: "overseerr", up, lines: up ? ["—"] : [] };
  }
}

async function piholeSvc(): Promise<ServiceResult> {
  try {
    const data = await svcFetch(
      "http://192.168.88.196:20720/api/stats/summary",
      { Authorization: "Bearer ***REMOVED***" }
    ) as { queries?: { total?: number; percent_blocked?: number } };
    const total   = data.queries?.total ?? 0;
    const blocked = (data.queries?.percent_blocked ?? 0).toFixed(1);
    return { name: "pihole", up: true, lines: [`${total.toLocaleString()} queries · ${blocked}% blocked`] };
  } catch {
    const up = await checkReachable("http://192.168.88.196:20720");
    return { name: "pihole", up, lines: up ? ["—"] : [] };
  }
}

async function prowlarrSvc(): Promise<ServiceResult> {
  try {
    const data = await svcFetch(
      "http://192.168.88.196:30050/api/v1/indexerstats?apikey=***REMOVED***"
    ) as { indexers?: { numberOfGrabs?: number; numberOfQueries?: number }[] };
    const indexers = data.indexers ?? [];
    const grabs    = indexers.reduce((s, i) => s + (i.numberOfGrabs   ?? 0), 0);
    const queries  = indexers.reduce((s, i) => s + (i.numberOfQueries ?? 0), 0);
    return { name: "prowlarr", up: true, lines: [`${indexers.length} indexers · ${grabs} grabs · ${queries} queries`] };
  } catch {
    const up = await checkReachable("http://192.168.88.196:30050");
    return { name: "prowlarr", up, lines: up ? ["—"] : [] };
  }
}

async function nginxSvc(): Promise<ServiceResult> {
  const BASE = "http://192.168.88.196:30020";
  try {
    const tokenRes = await fetch(`${BASE}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: "***REMOVED***", secret: "***REMOVED***" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!tokenRes.ok) throw new Error("auth");
    const { token } = await tokenRes.json() as { token: string };
    const data = await svcFetch(`${BASE}/api/nginx/proxy-hosts`, { Authorization: `Bearer ${token}` }) as { enabled: number | boolean; domain_names?: string[] }[];
    const enabled  = data.filter(h => h.enabled === 1 || h.enabled === true).length;
    const disabled = data.length - enabled;
    const domains  = data
      .filter(h => h.enabled === 1 || h.enabled === true)
      .flatMap(h => h.domain_names ?? [])
      .slice(0, 3);
    const lines: string[] = [`${enabled} enabled · ${disabled} disabled`];
    if (domains.length > 0) lines.push(...domains);
    return { name: "nginx", up: true, lines };
  } catch {
    const up = await checkReachable(BASE);
    return { name: "nginx", up, lines: up ? ["—"] : [] };
  }
}

interface SpeedtestRaw {
  ping?: number | null;
  download?: number | null;
  upload?: number | null;
  server_name?: string | null;
  server_host?: string | null;
  created_at?: string | null;
}

function normalizeSpeedResult(r: SpeedtestRaw): SpeedtestResult {
  return {
    ping:           r.ping        ?? null,
    download:       r.download    ?? null,
    upload:         r.upload      ?? null,
    created_at:     r.created_at  ?? null,
    jitter:         null,
    isp:            r.server_name ?? null,
    serverName:     r.server_name ?? null,
    serverLocation: r.server_host ?? null,
  };
}

// ── formatters ────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number | null, decimals = 1, unit: DataUnit = "decimal"): string {
  if (bytes === null || isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const k = unit === "binary" ? 1024 : 1000;
  const sizes = unit === "binary" ? ["B","KiB","MiB","GiB","TiB"] : ["B","KB","MB","GB","TB"];
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

function fmtTemp(c: number | null, unit: TempUnit = "C"): string {
  if (c === null) return "—";
  if (unit === "F") return `${((c * 9 / 5) + 32).toFixed(0)}°F`;
  return `${c.toFixed(0)}°C`;
}

function fmtUptime(s: number | null): string {
  if (s === null) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtSince(s: number | null): string {
  if (s === null) return "—";
  const b = new Date(Date.now() - s * 1000);
  const mo = b.toLocaleDateString(undefined, { month: "short" });
  return `${mo} ${b.getDate()} · ${String(b.getHours()).padStart(2, "0")}:${String(b.getMinutes()).padStart(2, "0")}`;
}

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

function pct(used: number | null, total: number | null): number {
  if (used === null || total === null || total === 0) return 0;
  return Math.min(100, (used / total) * 100);
}

// ── color helpers ─────────────────────────────────────────────────────────────

function barColor(p: number): string {
  if (p >= 90) return "#ef4444";
  if (p >= 75) return "#f59e0b";
  if (p >= 50) return "#06b6d4";
  return "#10b981";
}
function gpuUtilColor(p: number): string {
  if (p >= 90) return "#ef4444";
  if (p >= 70) return "#f59e0b";
  return "#10b981";
}
function tempColor(c: number): string {
  if (c >= 85) return "#ef4444";
  if (c >= 70) return "#f59e0b";
  return "#10b981";
}

// ── alert helpers ─────────────────────────────────────────────────────────────

function cpuAlertLevel(cpu: number | null): AlertLevel {
  if (cpu == null) return null;
  if (cpu > 95) return "critical";
  if (cpu > 80) return "warning";
  return null;
}

function memAlertLevel(total: number | null, available: number | null, sReclaimable: number | null): AlertLevel {
  if (total === null || available === null || total === 0) return null;
  const realUsed = total - available - (sReclaimable ?? 0);
  const realPct  = (Math.max(0, realUsed) / total) * 100;
  if (realPct > 95) return "critical";
  if (realPct > 85) return "warning";
  return null;
}

function diskAlertLevel(usedPct: number): AlertLevel {
  if (usedPct > 95) return "critical";
  if (usedPct > 85) return "warning";
  return null;
}

function gpuTempAlertLevel(temp: number | null): AlertLevel {
  if (temp == null) return null;
  if (temp > 90) return "critical";
  if (temp > 80) return "warning";
  return null;
}

function worstAlert(levels: AlertLevel[]): AlertLevel {
  if (levels.includes("critical")) return "critical";
  if (levels.includes("warning"))  return "warning";
  return null;
}

function computeHealth(m: Metrics | null): HealthResult {
  if (!m) return { status: "healthy", reason: "" };
  const issues: { level: AlertLevel; msg: string }[] = [];
  if (m.cpu != null) {
    const l = cpuAlertLevel(m.cpu);
    if (l) issues.push({ level: l, msg: `cpu ${m.cpu.toFixed(0)}%` });
  }
  {
    const l = memAlertLevel(m.memory.total, m.memory.available, m.memory.sReclaimable);
    if (l && m.memory.total && m.memory.available) {
      const rp = (Math.max(0, m.memory.total - m.memory.available - (m.memory.sReclaimable ?? 0)) / m.memory.total) * 100;
      issues.push({ level: l, msg: `ram ${rp.toFixed(0)}%` });
    }
  }
  if (m.gpu.temperature != null) {
    const l = gpuTempAlertLevel(m.gpu.temperature);
    if (l) issues.push({ level: l, msg: `gpu ${m.gpu.temperature.toFixed(0)}°C` });
  }
  for (const d of m.disks) {
    const l = diskAlertLevel(d.usedPct);
    if (l) issues.push({ level: l, msg: `disk ${d.mountpoint} ${d.usedPct.toFixed(0)}%` });
  }
  const crits = issues.filter(i => i.level === "critical");
  const warns = issues.filter(i => i.level === "warning");
  if (crits.length) return { status: "critical", reason: crits.map(i => i.msg).join("  ·  ") };
  if (warns.length) return { status: "warning",  reason: warns.map(i => i.msg).join("  ·  ") };
  return { status: "healthy", reason: "" };
}

// ── icons ─────────────────────────────────────────────────────────────────────

function IconCPU() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
      <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
      <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
      <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
      <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
    </svg>
  );
}
function IconMemory() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="10" rx="2"/>
      <line x1="6" y1="7" x2="6" y2="17"/><line x1="10" y1="7" x2="10" y2="17"/>
      <line x1="14" y1="7" x2="14" y2="17"/><line x1="18" y1="7" x2="18" y2="17"/>
      <line x1="6" y1="4" x2="6" y2="7"/><line x1="10" y1="4" x2="10" y2="7"/>
      <line x1="14" y1="4" x2="14" y2="7"/><line x1="18" y1="4" x2="18" y2="7"/>
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}
function IconDisk() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
    </svg>
  );
}
function IconNetwork() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="6" height="6" rx="1"/><rect x="16" y="2" width="6" height="6" rx="1"/>
      <rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/>
      <line x1="5" y1="8" x2="5" y2="16"/><line x1="19" y1="8" x2="19" y2="16"/>
      <line x1="8" y1="5" x2="16" y2="5"/><line x1="8" y1="19" x2="16" y2="19"/>
    </svg>
  );
}
function IconGPU() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="6" width="22" height="12" rx="2"/>
      <rect x="5" y="10" width="4" height="4" rx="1"/><rect x="11" y="10" width="4" height="4" rx="1"/>
      <line x1="5" y1="18" x2="5" y2="21"/><line x1="10" y1="18" x2="10" y2="21"/>
      <line x1="14" y1="18" x2="14" y2="21"/><line x1="19" y1="18" x2="19" y2="21"/>
    </svg>
  );
}
function IconRouter() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="9" width="22" height="7" rx="2"/>
      <line x1="5" y1="9" x2="5" y2="16"/>
      <line x1="9" y1="9" x2="9" y2="16"/>
      <circle cx="16.5" cy="12.5" r="1" fill="currentColor" stroke="none"/>
      <circle cx="19.5" cy="12.5" r="1" fill="currentColor" stroke="none"/>
      <line x1="7" y1="5" x2="7" y2="9"/>
      <line x1="12" y1="3" x2="12" y2="9"/>
      <line x1="17" y1="5" x2="17" y2="9"/>
    </svg>
  );
}

function IconServices() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5"  cy="5"  r="2.2"/><circle cx="12" cy="5"  r="2.2"/><circle cx="19" cy="5"  r="2.2"/>
      <circle cx="5"  cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/>
      <circle cx="5"  cy="19" r="2.2"/><circle cx="12" cy="19" r="2.2"/>
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function IconTrueNAS() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="4" rx="1"/>
      <rect x="2" y="10" width="20" height="4" rx="1"/>
      <rect x="2" y="17" width="20" height="4" rx="1"/>
      <circle cx="18" cy="5" r="0.8" fill="currentColor" stroke="none"/>
      <circle cx="18" cy="12" r="0.8" fill="currentColor" stroke="none"/>
      <circle cx="18" cy="19" r="0.8" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function IconSpeedtest() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 0 1 10 10"/>
      <path d="M12 2a10 10 0 0 0-10 10"/>
      <circle cx="12" cy="12" r="2"/>
      <path d="M12 12 L17 7"/>
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"/>
      <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  );
}

function SpeedtestBarChart({ results }: { results: SpeedtestResult[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const data = [...results].reverse(); // oldest first

    function draw() {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width, H = rect.height;
      if (W === 0 || H === 0) return;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.scale(dpr, dpr);

      const PAD_L = 40, PAD_R = 8, PAD_T = 8, PAD_B = 32;
      const chartW = W - PAD_L - PAD_R;
      const chartH = H - PAD_T - PAD_B;

      const dlVals = data.map(r => r.download ?? 0);
      const ulVals = data.map(r => r.upload ?? 0);
      const maxVal = Math.max(...dlVals, ...ulVals, 1) * 1.12;

      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i <= 4; i++) {
        const y = PAD_T + (1 - i / 4) * chartH;
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.font = `9px monospace`;
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(maxVal * i / 4)}`, PAD_L - 4, y + 3);
      }

      const n = data.length;
      const groupW = chartW / Math.max(n, 1);
      const barW = Math.max(3, Math.min(14, groupW * 0.38));

      data.forEach((r, i) => {
        const cx = PAD_L + i * groupW + groupW / 2;
        const dlH = ((r.download ?? 0) / maxVal) * chartH;
        ctx.fillStyle = "rgba(6,182,212,0.82)";
        ctx.fillRect(cx - barW - 1, PAD_T + chartH - dlH, barW, Math.max(2, dlH));
        const ulH = ((r.upload ?? 0) / maxVal) * chartH;
        ctx.fillStyle = "rgba(245,158,11,0.82)";
        ctx.fillRect(cx + 1, PAD_T + chartH - ulH, barW, Math.max(2, ulH));
        if (r.created_at && n <= 20) {
          const t = new Date(r.created_at);
          const label = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
          ctx.save();
          ctx.translate(cx, PAD_T + chartH + 5);
          ctx.rotate(-Math.PI / 4);
          ctx.fillStyle = "rgba(255,255,255,0.2)";
          ctx.font = `8px monospace`;
          ctx.textAlign = "right";
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      });
    }

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [results]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const tip = tooltipRef.current;
    if (!canvas || !tip || !results.length) return;
    const data = [...results].reverse();
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    const PAD_L = 40, PAD_R = 8, PAD_B = 32;
    const chartW = W - PAD_L - PAD_R;
    const relX = e.clientX - rect.left;
    const n = data.length;
    const groupW = chartW / Math.max(n, 1);
    const idx = Math.max(0, Math.min(n - 1, Math.floor((relX - PAD_L) / groupW)));
    const r = data[idx];
    const cx = PAD_L + idx * groupW + groupW / 2;
    const frac = cx / W;
    tip.style.display = "block";
    tip.style.left = frac < 0.6 ? `${cx + 6}px` : `${cx - 90}px`;
    tip.style.top = `${(H - PAD_B) * 0.12}px`;
    tip.innerHTML = `
      <div style="color:#06b6d4">↓ ${r.download?.toFixed(0) ?? "—"} Mbps</div>
      <div style="color:#f59e0b">↑ ${r.upload?.toFixed(0) ?? "—"} Mbps</div>
      ${r.ping != null ? `<div style="color:#10b981">${r.ping < 10 ? r.ping.toFixed(1) : r.ping.toFixed(0)} ms ping</div>` : ""}
      ${r.created_at ? `<div style="color:rgba(255,255,255,0.3);margin-top:2px">${new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>` : ""}
    `;
  }

  function handleMouseLeave() {
    const tip = tooltipRef.current;
    if (tip) tip.style.display = "none";
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {/* Legend */}
      <div style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 10, fontSize: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <div style={{ width: 8, height: 8, background: "#00e5ff", borderRadius: 1, opacity: 0.82 }} />
          <span style={{ color: "rgba(255,255,255,0.4)" }}>Download</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <div style={{ width: 8, height: 8, background: "#ff9100", borderRadius: 1, opacity: 0.82 }} />
          <span style={{ color: "rgba(255,255,255,0.4)" }}>Upload</span>
        </div>
      </div>
      {/* Tooltip */}
      <div ref={tooltipRef} style={{
        display: "none", position: "absolute", background: "rgba(10,10,10,0.92)",
        border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4,
        padding: "4px 8px", fontSize: 9, pointerEvents: "none", whiteSpace: "nowrap",
      }} />
    </div>
  );
}

function ServiceIcon({ src, label, color }: { src: string; label: string; color: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
        style={{ background: `${color}22`, color }}>
        {label[0].toUpperCase()}
      </span>
    );
  }
  return (
    <img src={src} alt={label} width={32} height={32}
      className="w-8 h-8 rounded-lg object-contain shrink-0"
      style={{ background: "#161616" }}
      onError={() => setErr(true)}
    />
  );
}

function BookmarkItem({ name, url, icon }: { name: string; url: string; icon: string }) {
  const [imgErr, setImgErr] = useState(false);
  const fallback = `https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(url).hostname; } catch { return "example.com"; } })()}&sz=32`;
  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2.5 px-2 rounded-lg"
      style={{
        textDecoration: "none", height: 36, flexShrink: 0,
        transition: "background 0.15s ease, transform 0.15s ease",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.transform = "translateX(4px)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "translateX(0)"; }}
    >
      {!imgErr ? (
        <img
          src={icon.startsWith("http") ? icon : fallback}
          alt="" width={18} height={18}
          className="rounded shrink-0" style={{ objectFit: "contain", width: 18, height: 18, borderRadius: 4 }}
          onError={(e) => {
            const img = e.currentTarget;
            if (img.src !== fallback) { img.src = fallback; }
            else { setImgErr(true); }
          }}
        />
      ) : (
        <span className="rounded flex items-center justify-center font-bold shrink-0"
          style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", width: 18, height: 18, fontSize: 9 }}>
          {name[0].toUpperCase()}
        </span>
      )}
      <span className="truncate" style={{ color: "rgba(255,255,255,0.8)", fontSize: 13 }}>{name}</span>
    </a>
  );
}

// ── primitive components ──────────────────────────────────────────────────────

function GaugeBar({ percent, color, thin = false }: { percent: number; color: string; thin?: boolean }) {
  return (
    <div className={`relative w-full rounded-full overflow-hidden`} style={{ background: "rgba(255,255,255,0.08)", height: thin ? 3 : 5 }}>
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${percent}%`, background: color, boxShadow: `0 0 ${thin ? 3 : 6}px ${color}55` }}
      />
    </div>
  );
}

function Sparkline({ data, color, autoMax = false, height = 32 }: {
  data: number[]; color: string; autoMax?: boolean; height?: number;
}) {
  const uid = useId();
  if (data.length < 2) return <div style={{ height }} />;
  const W = 100, H = height, PAD = 1;
  const maxVal = autoMax ? Math.max(...data, 0.001) : 100;
  const pts = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - Math.min(Math.max(v, 0), maxVal) / maxVal) * (H - PAD * 2);
    return [x.toFixed(2), y.toFixed(2)];
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`;
  const gid  = `sg${uid.replace(/:/g, "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height, display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

function MiniBarChart({ data, color, height = 32 }: { data: number[]; color: string; height?: number }) {
  const last20 = data.slice(-20);
  const maxVal = Math.max(...last20, 0.001);
  return (
    <div className="flex items-end gap-px w-full" style={{ height }}>
      {Array.from({ length: 20 }, (_, i) => {
        const val = last20[i] ?? 0;
        const h = Math.max(2, (val / maxVal) * height);
        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-all duration-500"
            style={{
              height: h,
              background: color,
              opacity: i < last20.length ? 0.75 : 0.1,
              boxShadow: val > maxVal * 0.7 ? `0 0 4px ${color}55` : "none",
            }}
          />
        );
      })}
    </div>
  );
}

function DonutChart({ used, total, color, size = 72 }: { used: number; total: number; color: string; size?: number }) {
  const pctVal = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const r = 28, circ = 2 * Math.PI * r;
  const filled = (pctVal / 100) * circ;
  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 72 72" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}55)`, transition: "stroke-dasharray 0.7s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-[11px] font-medium tabular-nums" style={{ color: "#ffffff" }}>{pctVal.toFixed(0)}%</div>
      </div>
    </div>
  );
}

function ThreeSegmentDonut({ usedBytes, cacheBytes, freeBytes, totalBytes, du }: {
  usedBytes: number; cacheBytes: number; freeBytes: number; totalBytes: number; du: DataUnit;
}) {
  const r = 36, circ = 2 * Math.PI * r;
  const safe = (v: number) => (isNaN(v) ? 0 : Math.max(0, v));
  const total = safe(totalBytes);
  const used  = safe(usedBytes);
  const cache = safe(cacheBytes);
  const free  = safe(freeBytes);
  const usedLen  = total > 0 ? (used  / total) * circ : 0;
  const cacheLen = total > 0 ? (cache / total) * circ : 0;
  const freeLen  = total > 0 ? (free  / total) * circ : 0;
  const usedPct  = total > 0 ? (used  / total) * 100  : 0;
  const size = 100;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 88 88" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="44" cy="44" r={r} fill="none" stroke="#161616" strokeWidth="9" />
          {usedLen > 0.1 && (
            <circle cx="44" cy="44" r={r} fill="none" stroke="#ff1744" strokeWidth="9"
              strokeDasharray={`${usedLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeDashoffset={0}
              style={{ filter: "drop-shadow(0 0 3px #ff174444)", transition: "stroke-dasharray 0.7s ease" }}
            />
          )}
          {cacheLen > 0.1 && (
            <circle cx="44" cy="44" r={r} fill="none" stroke="#2a2a2a" strokeWidth="9"
              strokeDasharray={`${cacheLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeDashoffset={(-usedLen).toFixed(2)}
              style={{ transition: "stroke-dasharray 0.7s ease" }}
            />
          )}
          {freeLen > 0.1 && (
            <circle cx="44" cy="44" r={r} fill="none" stroke="#00c853" strokeWidth="9"
              strokeDasharray={`${freeLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeDashoffset={(-(usedLen + cacheLen)).toFixed(2)}
              style={{ filter: "drop-shadow(0 0 3px #00c85333)", transition: "stroke-dasharray 0.7s ease" }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-medium tabular-nums" style={{ color: "#e4e4e4" }}>
            {total > 0 ? `${usedPct.toFixed(0)}%` : "—"}
          </span>
          <span className="text-[9px]" style={{ color: "#333" }}>used</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 w-full">
        {[
          { label: "used",      color: "#ff1744", bytes: used  },
          { label: "zfs cache", color: "#2a2a2a", bytes: cache },
          { label: "free",      color: "#00c853", bytes: free  },
        ].map(({ label, color, bytes }) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <span className="text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
            </div>
            <span className="text-[10px] tabular-nums font-medium" style={{ color: "rgba(255,255,255,0.65)" }}>
              {fmtBytes(bytes, 1, du)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LabeledBar({ label, right, percent, color }: {
  label: string; right: string; percent: number; color: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
        <span className="text-xs font-medium tabular-nums" style={{ color: "rgba(255,255,255,0.65)" }}>{right}</span>
      </div>
      <GaugeBar percent={percent} color={color} />
    </div>
  );
}

function Card({
  label, subtitle, children, accent = "#06b6d4", alertLevel = null,
  icon, expanded = false, onToggle, externalLink, animDelay = 0,
}: {
  label: string; subtitle?: string; children: React.ReactNode; accent?: string;
  alertLevel?: AlertLevel; icon?: React.ReactNode; expanded?: boolean; onToggle?: () => void;
  externalLink?: string; animDelay?: number;
}) {
  const [hov, setHov] = useState(false);

  const borderColor =
    alertLevel === "critical" ? "rgba(239,68,68,0.45)"
    : alertLevel === "warning" ? "rgba(245,158,11,0.4)"
    : hov ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)";

  const topColor =
    alertLevel === "critical" ? "#ef4444"
    : alertLevel === "warning" ? "#f59e0b"
    : accent;

  return (
    <div
      className="flex flex-col cursor-pointer h-full"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={externalLink ? () => window.open(externalLink, "_blank") : onToggle}
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        border: `1px solid ${borderColor}`,
        borderTop: `2px solid ${topColor}`,
        borderRadius: 14,
        transform: hov ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hov ? "0 8px 32px rgba(0,0,0,0.35)" : "none",
        transition: "border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease",
        animation: "fadeSlideIn 0.45s ease both",
        animationDelay: `${animDelay}ms`,
      }}
    >
      <div className="flex items-center gap-2 overflow-hidden px-[18px] pt-[18px] pb-0">
        {icon && <span style={{ color: accent, opacity: 0.7 }}>{icon}</span>}
        <span className="text-[10px] uppercase shrink-0" style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em" }}>{label}</span>
        {subtitle && <span className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.3)" }}>{subtitle}</span>}
        <span className="ml-auto text-[9px]" style={{ color: "rgba(255,255,255,0.15)" }}>{externalLink ? "↗" : expanded ? "▲" : "▼"}</span>
      </div>
      <div className="px-[18px] pt-3 pb-[18px] flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}

function StatusBanner({ result, visible }: { result: HealthResult; visible: boolean }) {
  const { status, reason } = result;

  if (status === "warning") {
    return (
      <div className="flex items-center gap-3 px-4 rounded-lg"
        style={{
          background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)",
          height: 36, opacity: visible ? 1 : 0, transition: "opacity 0.4s ease",
        }}>
        <span className="block shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ background: "#f59e0b", boxShadow: "0 0 6px #f59e0b66", animation: "pulseDot 2s ease-in-out infinite" }} />
        <span className="text-[10px] tracking-[0.2em] font-semibold uppercase" style={{ color: "#f59e0b" }}>WARNING</span>
        {reason && <span className="text-[10px]" style={{ color: "rgba(245,158,11,0.7)" }}>· {reason}</span>}
      </div>
    );
  }

  if (status === "critical") {
    return (
      <div className="flex items-center gap-3 px-4 rounded-lg"
        style={{
          background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)",
          height: 48, opacity: visible ? 1 : 0, transition: "opacity 0.4s ease",
        }}>
        <span className="text-sm font-bold leading-none" style={{ color: "#ef4444" }}>✕</span>
        <span className="block shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ background: "#ef4444", boxShadow: "0 0 8px #ef444466", animation: "pulseDot 2s ease-in-out infinite" }} />
        <span className="text-[10px] tracking-[0.2em] font-semibold uppercase" style={{ color: "#ef4444" }}>CRITICAL</span>
        {reason && <span className="text-[10px]" style={{ color: "rgba(239,68,68,0.7)" }}>· {reason}</span>}
      </div>
    );
  }

  return null;
}

function Skeleton() {
  return <div className="skeleton h-8 w-24 rounded" />;
}

function BigValue({ value, loading }: { value: string; loading?: boolean }) {
  const [renderKey, setRenderKey] = useState(0);
  const prevRef = useRef(value);
  useEffect(() => {
    if (!loading && value !== prevRef.current) {
      const wasReal = prevRef.current !== "—";
      prevRef.current = value;
      if (wasReal && value !== "—") setRenderKey(k => k + 1);
    }
  }, [value, loading]);
  if (loading) return <Skeleton />;
  return (
    <span
      key={renderKey}
      className="text-3xl font-medium tracking-tight"
      style={{ color: "#ffffff", display: "inline-block", animation: renderKey > 0 ? "valueIn 0.35s ease-out forwards" : "none" }}
    >
      {value}
    </span>
  );
}

function SubRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
      <span className="text-xs font-medium tabular-nums" style={{ color: valueColor ?? "rgba(255,255,255,0.65)" }}>{value}</span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
      <span className="text-[10px] tabular-nums font-medium" style={{ color: "rgba(255,255,255,0.65)" }}>{value}</span>
    </div>
  );
}

// ── google search ─────────────────────────────────────────────────────────────

function GoogleSearch({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  function doSearch() {
    const q = query.trim();
    if (q) window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank");
  }

  return (
    <div style={{ width: "100%", maxWidth: 600, margin: "0 auto" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(255,255,255,0.05)",
          border: `1px solid ${focused ? "rgba(6,182,212,0.5)" : "rgba(255,255,255,0.12)"}`,
          borderRadius: 999, padding: "10px 20px",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          boxShadow: focused ? "0 0 0 3px rgba(6,182,212,0.15)" : "none",
          transform: focused ? "scale(1.01)" : "scale(1)",
          transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search Google…"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") doSearch(); if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1, background: "none", border: "none", outline: "none",
            fontSize: 14, color: "#ffffff", fontFamily: "inherit",
            caretColor: "#06b6d4",
          }}
        />
        <button onClick={doSearch}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(255,255,255,0.3)", display: "flex", transition: "color 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── settings panel ─────────────────────────────────────────────────────────────

const CARD_KEYS = ["cpu", "memory", "filesystems", "network", "gpu", "speedtest", "system", "services"] as const;

function SettingsPanel({ settings, onUpdate, onClose }: {
  settings: Settings; onUpdate: (s: Settings) => void; onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col gap-5 p-6 overflow-y-auto"
        style={{ width: 272, background: "#0e0e0e", borderLeft: "1px solid #1a1a1a", boxShadow: "-12px 0 40px rgba(0,0,0,0.7)" }}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] tracking-widest uppercase" style={{ color: "#444" }}>Settings</span>
          <button onClick={onClose} style={{ color: "#333", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>

        {[
          { title: "Refresh", options: [5, 10, 30, 60], key: "refreshInterval" as const, fmt: (v: number) => `${v}s` },
        ].map(({ title, options, key, fmt }) => (
          <div key={key} className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-widest" style={{ color: "#2e2e2e" }}>{title}</span>
            <div className="flex gap-1.5">
              {options.map(o => (
                <button key={o} onClick={() => onUpdate({ ...settings, [key]: o })}
                  className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150"
                  style={{
                    background: settings[key] === o ? "#00e5ff14" : "#161616",
                    border: `1px solid ${settings[key] === o ? "#00e5ff33" : "#1e1e1e"}`,
                    color: settings[key] === o ? "#00e5ff" : "#444", cursor: "pointer",
                  }}
                >{fmt(o)}</button>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "#2e2e2e" }}>Temperature</span>
          <div className="flex gap-1.5">
            {(["C", "F"] as TempUnit[]).map(u => (
              <button key={u} onClick={() => onUpdate({ ...settings, tempUnit: u })}
                className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150"
                style={{
                  background: settings.tempUnit === u ? "#00e5ff14" : "#161616",
                  border: `1px solid ${settings.tempUnit === u ? "#00e5ff33" : "#1e1e1e"}`,
                  color: settings.tempUnit === u ? "#00e5ff" : "#444", cursor: "pointer",
                }}
              >°{u}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "#2e2e2e" }}>Data Units</span>
          <div className="flex gap-1.5">
            {(["decimal", "binary"] as DataUnit[]).map(u => (
              <button key={u} onClick={() => onUpdate({ ...settings, dataUnit: u })}
                className="flex-1 py-1.5 rounded text-[10px] font-medium transition-all duration-150"
                style={{
                  background: settings.dataUnit === u ? "#00e5ff14" : "#161616",
                  border: `1px solid ${settings.dataUnit === u ? "#00e5ff33" : "#1e1e1e"}`,
                  color: settings.dataUnit === u ? "#00e5ff" : "#444", cursor: "pointer",
                }}
              >{u === "decimal" ? "GB" : "GiB"}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "#2e2e2e" }}>Visible Cards</span>
          {CARD_KEYS.map(c => {
            const on = settings.visibleCards[c] !== false;
            return (
              <label key={c} className="flex items-center gap-3 cursor-pointer" onClick={() => onUpdate({ ...settings, visibleCards: { ...settings.visibleCards, [c]: !on } })}>
                <div className="relative w-7 h-4 rounded-full transition-all duration-200"
                  style={{ background: on ? "#00e5ff22" : "#161616", border: `1px solid ${on ? "#00e5ff44" : "#1e1e1e"}` }}>
                  <div className="absolute top-0.5 w-3 h-3 rounded-full transition-all duration-200"
                    style={{ left: on ? "calc(100% - 14px)" : "2px", background: on ? "#00e5ff" : "#2a2a2a" }} />
                </div>
                <span className="text-[10px] uppercase tracking-widest" style={{ color: on ? "#555" : "#2e2e2e" }}>{c}</span>
              </label>
            );
          })}
        </div>

        <div style={{ height: 1, background: "#161616", marginTop: "auto" }} />
        <span className="text-[9px] text-center" style={{ color: "#1e1e1e" }}>resets on page reload</span>
      </div>
    </>
  );
}

// ── mikrotik tab ─────────────────────────────────────────────────────────────

interface MtData {
  board: string | null;
  version: string | null;
  cpu: number | null;
  ramUsed: string | null;
  ramTotal: string | null;
  ramPct: number | null;
  hddUsed: number | null;
  hddTotal: number | null;
  uptime: string | null;
  temp: number | null;
}

function MikrotikTab() {
  const [data, setData] = useState<MtData | null>(null);
  const [corsBlocked, setCorsBlocked] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/mikrotik", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const d = await res.json() as MtData & { error?: string };
        if (d.error) throw new Error(d.error);
        setData({
          board:    d.board,
          version:  d.version,
          cpu:      d.cpu,
          ramUsed:  d.ramUsed,
          ramTotal: d.ramTotal,
          ramPct:   d.ramPct,
          hddUsed:  d.hddUsed,
          hddTotal: d.hddTotal,
          uptime:   d.uptime,
          temp:     d.temp,
        });
        setCorsBlocked(false);
      } catch {
        setCorsBlocked(true);
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const pill = (label: string, value: string, pctVal?: number, tempVal?: number | null) => {
    const tempColor = tempVal == null ? null : tempVal > 80 ? "#ff1744" : tempVal > 60 ? "#ff9100" : "#00e676";
    return (
      <div key={label} className="flex items-center gap-2 shrink-0">
        <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>{label}</span>
        <span style={{ color: tempColor ?? "rgba(255,255,255,0.9)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {pctVal != null && (
          <div style={{ width: 36, height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${pctVal}%`, height: "100%", background: pctVal > 85 ? "#ff1744" : pctVal > 65 ? "#ff9100" : "#00e5ff", borderRadius: 2 }} />
          </div>
        )}
      </div>
    );
  };

  const sep = () => <span style={{ color: "rgba(255,255,255,0.1)", fontSize: 14, userSelect: "none" }}>|</span>;

  const fmtMtBytes = (b: number | null) => {
    if (b == null) return "—";
    if (b < 1e6) return `${(b / 1e3).toFixed(0)} KB`;
    if (b < 1e9) return `${(b / 1e6).toFixed(0)} MB`;
    return `${(b / 1e9).toFixed(1)} GB`;
  };

  const staticSep = () => <span style={{ color: "rgba(255,255,255,0.12)", fontSize: 14, userSelect: "none", flexShrink: 0 }}>|</span>;
  const staticPill = (label: string, value: string) => (
    <div className="flex items-center gap-1.5 shrink-0">
      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );

  if (corsBlocked || !data) {
    return (
      <a href="http://192.168.88.1" target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-4 w-full overflow-x-auto"
        style={{
          background: "rgba(15,18,30,0.9)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10, padding: "12px 20px",
          textDecoration: "none", cursor: "pointer",
          transition: "border-color 0.2s, background 0.2s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.background = "rgba(20,24,40,0.95)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.background = "rgba(15,18,30,0.9)"; }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="9" width="22" height="7" rx="2"/>
            <line x1="5" y1="9" x2="5" y2="16"/><line x1="9" y1="9" x2="9" y2="16"/>
            <circle cx="16.5" cy="12.5" r="1" fill="#06b6d4" stroke="none"/>
            <circle cx="19.5" cy="12.5" r="1" fill="#06b6d4" stroke="none"/>
            <line x1="7" y1="5" x2="7" y2="9"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="17" y1="5" x2="17" y2="9"/>
          </svg>
          <span style={{ color: "#ffffff", fontWeight: 700, fontSize: 14 }}>MikroTik</span>
          <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>hAP ax³</span>
        </div>
        {staticSep()}
        {staticPill("RouterOS", "7.22.1")}
        {staticSep()}
        {staticPill("IP", "192.168.88.1")}
        {staticSep()}
        {staticPill("CPU", "—")}
        {staticSep()}
        {staticPill("RAM", "—")}
        {staticSep()}
        {staticPill("Uptime", "13d 4h")}
        <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>tap to open ↗</span>
      </a>
    );
  }

  const cpuPct = data.cpu ?? 0;
  const memPct = data.ramPct ?? 0;
  const hddPct = data.hddTotal && data.hddUsed ? (data.hddUsed / data.hddTotal) * 100 : 0;

  return (
    <a href="http://192.168.88.1" target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-4 w-full overflow-x-auto"
      style={{
        background: "rgba(15,18,30,0.9)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10, padding: "12px 20px", textDecoration: "none", cursor: "pointer",
        transition: "border-color 0.2s, background 0.2s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.background = "rgba(20,24,40,0.95)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.background = "rgba(15,18,30,0.9)"; }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="9" width="22" height="7" rx="2"/>
          <line x1="5" y1="9" x2="5" y2="16"/><line x1="9" y1="9" x2="9" y2="16"/>
          <circle cx="16.5" cy="12.5" r="1" fill="#06b6d4" stroke="none"/>
          <circle cx="19.5" cy="12.5" r="1" fill="#06b6d4" stroke="none"/>
          <line x1="7" y1="5" x2="7" y2="9"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="17" y1="5" x2="17" y2="9"/>
        </svg>
        <span style={{ color: "#ffffff", fontWeight: 700, fontSize: 14 }}>MikroTik</span>
      </div>
      {sep()}
      {data.board && pill("Model", data.board)}
      {data.version && <>{sep()}{pill("RouterOS", data.version)}</>}
      {data.cpu != null && <>{sep()}{pill("CPU", `${data.cpu}%`, cpuPct)}</>}
      {data.ramTotal != null && <>{sep()}{pill("RAM", `${data.ramUsed ?? "—"} / ${data.ramTotal}`, memPct)}</>}
      {data.hddTotal != null && <>{sep()}{pill("Storage", `${fmtMtBytes(data.hddUsed)} / ${fmtMtBytes(data.hddTotal)}`, hddPct)}</>}
      {data.uptime && <>{sep()}{pill("Uptime", data.uptime)}</>}
      {data.temp != null && <>{sep()}{pill("Temp", `${data.temp}°C`, undefined, data.temp)}</>}
      <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>tap to open ↗</span>
    </a>
  );
}

// ── dashboard ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = { refreshInterval: 10, tempUnit: "C", dataUnit: "decimal", visibleCards: {} };

export default function Dashboard() {
  const [metrics,      setMetrics]      = useState<Metrics | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [lastUpdated,  setLastUpdated]  = useState<string>("");
  const [mounted,      setMounted]      = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [settings,     setSettings]     = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings,   setShowSettings]   = useState(false);
  const [expandedCard,   setExpandedCard]   = useState<string | null>(null);
  const [showHealth,     setShowHealth]     = useState(true);
  const [showBookmarks,  setShowBookmarks]  = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [cpuHistory,     setCpuHistory]     = useState<number[]>([]);
  const [memHistory,     setMemHistory]     = useState<number[]>([]);
  const [gpuHistory,     setGpuHistory]     = useState<number[]>([]);
  const [gpuTempHistory, setGpuTempHistory] = useState<number[]>([]);
  const [rxHistory,      setRxHistory]      = useState<number[]>([]);
  const [txHistory,      setTxHistory]      = useState<number[]>([]);


  const [weather,            setWeather]            = useState<{ temp: number | null; condition: string | null } | null>(null);
  const [services,           setServices]           = useState<{ name: string; up: boolean; lines: string[]; pct?: number; downCount?: number }[] | null>(null);
  const [servicesLoading,    setServicesLoading]    = useState(true);
  const [servicesUpdatedAt,  setServicesUpdatedAt]  = useState<number | null>(null);
  const [speedtestResults, setSpeedtestResults] = useState<SpeedtestResult[]>([]);
  const [speedtestLoading, setSpeedtestLoading] = useState(true);
  const [clockDate,        setClockDate]        = useState("");
  const [clockTime,        setClockTime]        = useState("");

  useEffect(() => { setMounted(true); }, []);

  const fetchMetrics = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Metrics = await res.json();
      setMetrics(data);
      if (data.cpu != null) setCpuHistory(h => [...h, data.cpu!].slice(-MAX_HISTORY));
      const realUsed = data.memory.total != null && data.memory.available != null
        ? Math.max(0, data.memory.total - data.memory.available - (data.memory.sReclaimable ?? 0)) : null;
      setMemHistory(h => [...h, pct(realUsed, data.memory.total)].slice(-MAX_HISTORY));
      if (data.gpu?.utilization != null) setGpuHistory(h => [...h, data.gpu.utilization!].slice(-MAX_HISTORY));
      if (data.gpu?.temperature != null) setGpuTempHistory(h => [...h, data.gpu.temperature!].slice(-MAX_HISTORY));
      setRxHistory(h => [...h, data.network.rxBytesPerSec ?? 0].slice(-MAX_HISTORY));
      setTxHistory(h => [...h, data.network.txBytesPerSec ?? 0].slice(-MAX_HISTORY));
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
      setTimeout(() => setRefreshing(false), 800);
    }
  }, []);


  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch("/api/services", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServices(data.services ?? null);
      setServicesUpdatedAt(Date.now());
    } catch {
      setServices(null);
    } finally {
      setServicesLoading(false);
    }
  }, []);

  const fetchSpeedtest = useCallback(async () => {
    try {
      const res = await fetch("/api/speedtest", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSpeedtestResults(data.results ?? []);
    } catch {
      setSpeedtestResults([]);
    } finally {
      setSpeedtestLoading(false);
    }
  }, []);

  const fetchWeather = useCallback(async () => {
    try {
      const res = await fetch("/api/weather");
      if (!res.ok) return;
      const data = await res.json();
      if (!data.error) setWeather({ temp: data.temp, condition: data.condition });
    } catch {
      // weather is non-critical; fail silently
    }
  }, []);

  // Clock — updates every second
  useEffect(() => {
    function tick() {
      const now = new Date();
      const days   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const h = String(now.getHours()).padStart(2, "0");
      const m = String(now.getMinutes()).padStart(2, "0");
      const s = String(now.getSeconds()).padStart(2, "0");
      setClockDate(`${days[now.getDay()]} · ${now.getDate()} ${months[now.getMonth()]}`);
      setClockTime(`${h}:${m}:${s}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Weather — fetch once on mount, refresh every 10 minutes
  useEffect(() => {
    fetchWeather();
    const id = setInterval(fetchWeather, 600_000);
    return () => clearInterval(id);
  }, [fetchWeather]);

  // Services — refresh every 10 seconds
  useEffect(() => {
    fetchServices();
    const id = setInterval(fetchServices, 10_000);
    return () => clearInterval(id);
  }, [fetchServices]);

  // Speedtest — refresh every 5 minutes
  useEffect(() => {
    fetchSpeedtest();
    const id = setInterval(fetchSpeedtest, 300_000);
    return () => clearInterval(id);
  }, [fetchSpeedtest]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    fetchMetrics();
    intervalRef.current = setInterval(() => { fetchMetrics(); }, settings.refreshInterval * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchMetrics, settings.refreshInterval]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "Escape") { setShowSettings(false); setExpandedCard(null); (e.target as HTMLElement)?.blur?.(); return; }
      if (isTyping) return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); fetchMetrics(); }
      if (e.key === "g" || e.key === "G") { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === "h" || e.key === "H") setShowBookmarks(v => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fetchMetrics]);

  // derived
  const cpuPct      = pct(metrics?.cpu ?? null, 100);
  const memTotal    = metrics?.memory.total ?? null;
  const realMemUsed = memTotal != null && metrics?.memory.available != null
    ? Math.max(0, memTotal - metrics.memory.available - (metrics.memory.sReclaimable ?? 0)) : null;
  const realMemPct  = pct(realMemUsed, memTotal);
  const gpuUtil     = metrics?.gpu?.utilization ?? null;
  const gpuMemPct   = pct(metrics?.gpu?.memUsed ?? null, metrics?.gpu?.memTotal ?? null);
  const gpuPwrPct   = pct(metrics?.gpu?.powerDraw ?? null, metrics?.gpu?.powerLimit ?? null);
  const gpuColor    = gpuUtil != null ? gpuUtilColor(gpuUtil) : "#ef4444";

  const cpuAlert     = cpuAlertLevel(metrics?.cpu ?? null);
  const memAlert     = memAlertLevel(metrics?.memory.total ?? null, metrics?.memory.available ?? null, metrics?.memory.sReclaimable ?? null);
  const gpuTempAlert = gpuTempAlertLevel(metrics?.gpu?.temperature ?? null);
  const maxDiskAlert = worstAlert(metrics?.disks.map(d => diskAlertLevel(d.usedPct)) ?? []);
  const health       = computeHealth(metrics);

  function histStats(h: number[]) {
    if (!h.length) return { min: null as number | null, max: null as number | null, avg: null as number | null };
    return { min: Math.min(...h), max: Math.max(...h), avg: h.reduce((a, b) => a + b, 0) / h.length };
  }

  const isVisible  = (k: string) => settings.visibleCards[k] !== false;
  const toggleCard = (k: string) => setExpandedCard(e => e === k ? null : k);
  const du = settings.dataUnit;
  const tu = settings.tempUnit;

  return (
    <>
      {/* top loading bar */}
      <div className="fixed top-0 left-0 right-0 z-50" style={{ height: 2 }}>
        <div style={{
          height: "100%",
          background: "linear-gradient(90deg, #00e5ff, #00e676)",
          boxShadow: "0 0 8px #00e5ff66",
          transition: refreshing ? "width 0.5s ease" : "width 0.8s ease, opacity 0.5s ease 0.3s",
          width: refreshing ? "80%" : loading ? "35%" : "100%",
          opacity: (refreshing || loading) ? 1 : 0,
        }} />
      </div>
      {/* healthy state line — 2px cyan at very top */}
      {!loading && showHealth && health.status === "healthy" && mounted && (
        <div className="fixed top-0 left-0 right-0 z-40" style={{
          height: 2, background: "#06b6d4", boxShadow: "0 0 8px rgba(6,182,212,0.5)",
        }} />
      )}

      {/* ── sticky frosted header ── */}
      <header className="fixed top-0 left-0 right-0 z-30" style={{
        background: "rgba(10,12,20,0.9)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}>
        <div className="max-w-5xl mx-auto px-6 py-2.5 flex items-center justify-between gap-4">
          {/* Left */}
          <div className="flex items-center gap-3 min-w-0">
            <span className="block w-2 h-2 rounded-full shrink-0"
              style={{ background: "#10b981", boxShadow: "0 0 6px #10b98166", animation: "pulseDot 2s ease-in-out infinite", "--dot-color": "#10b981" } as React.CSSProperties} />
            <h1 className="shrink-0 font-mono" style={{ fontSize: 18, fontWeight: 700, color: "#ffffff", letterSpacing: "-0.02em" }}>
              home<span style={{ color: "#06b6d4" }}>lab</span>
            </h1>
            <span className="shrink-0" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "rgba(255,255,255,0.85)", letterSpacing: "0.04em" }}>
              truenas · :30104
            </span>
            {metrics?.uptime != null && (
              <span className="flex items-center gap-1.5 shrink-0" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "rgba(255,255,255,0.85)" }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                {fmtUptime(metrics.uptime)}
                <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
                <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 10 }}>{fmtSince(metrics.uptime)}</span>
              </span>
            )}
            {weather && (
              <span className="shrink-0 hidden sm:inline" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "rgba(255,255,255,0.85)" }}>
                {weather.temp != null ? `${weather.temp.toFixed(0)}°C` : ""}
                {weather.condition ? ` · ${weather.condition}` : ""}
              </span>
            )}
          </div>
          {/* Right */}
          <div className="flex items-center gap-3 shrink-0">
            {clockDate && (
              <div className="flex flex-col items-end leading-tight">
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "inherit" }}>{clockDate}</span>
                <span className="font-mono tabular-nums" style={{ fontSize: 13, color: "#ffffff", fontWeight: 600 }}>{clockTime}</span>
              </div>
            )}
            {error && (
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                {error}
              </span>
            )}
            <span className="block w-1.5 h-1.5 rounded-full"
              style={{
                background: error ? "#ef4444" : loading ? "rgba(255,255,255,0.2)" : "#10b981",
                boxShadow: error ? "0 0 6px #ef444466" : !loading ? "0 0 6px #10b98166" : "none",
                animation: !error && !loading ? "pulseDot 2s ease-in-out infinite" : "none",
              }} />
            <button
              title="Open TrueNAS"
              onClick={() => window.open("http://192.168.88.196", "_blank")}
              style={{ color: "rgba(255,255,255,0.2)", background: "none", border: "none", cursor: "pointer", padding: 2, transition: "color 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#06b6d4")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.2)")}
            ><IconTrueNAS /></button>
            <button
              onClick={() => setShowSettings(v => !v)}
              style={{ color: showSettings ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)", background: "none", border: "none", cursor: "pointer", padding: 2, transition: "color 0.2s" }}
            ><IconGear /></button>
          </div>
        </div>
      </header>

      <main
        className="w-full min-h-screen"
        style={{
          background: "#0a0c12",
          backgroundImage: "radial-gradient(ellipse at 50% 0%, rgba(30,40,80,0.35) 0%, transparent 65%)",
          fontFamily: "'Inter', system-ui, sans-serif",
          opacity: mounted ? 1 : 0,
          transition: "opacity 0.5s ease-out",
        }}
      >
        <div className="max-w-5xl mx-auto px-6 pb-10 flex flex-col gap-6" style={{ paddingTop: 80 }}>


          {/* ── google search ── */}
          <GoogleSearch inputRef={searchInputRef} />

          {/* ── mikrotik tab ── */}
          <MikrotikTab />

          {/* ── status banner ── */}
          {!loading && showHealth && health.status !== "healthy" && (
            <StatusBanner result={health} visible={mounted} />
          )}

          {/* ── grid ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">

            {/* CPU */}
            {isVisible("cpu") && (
              <Card label="cpu" accent="#06b6d4" alertLevel={cpuAlert} icon={<IconCPU />}
                animDelay={0} expanded={expandedCard === "cpu"} onToggle={() => toggleCard("cpu")}>
                <BigValue value={fmtPct(metrics?.cpu ?? null)} loading={loading} />
                <Sparkline data={cpuHistory} color={barColor(cpuPct)} height={36} />
                <GaugeBar percent={cpuPct} color={barColor(cpuPct)} />
                <SubRow label="utilization" value={fmtPct(metrics?.cpu ?? null)} />
                {expandedCard === "cpu" && (() => {
                  const s = histStats(cpuHistory);
                  return (
                    <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid #181818" }}>
                      <StatRow label="min" value={s.min != null ? fmtPct(s.min) : "—"} />
                      <StatRow label="max" value={s.max != null ? fmtPct(s.max) : "—"} />
                      <StatRow label="avg" value={s.avg != null ? fmtPct(s.avg) : "—"} />
                    </div>
                  );
                })()}
              </Card>
            )}

            {/* Memory */}
            {isVisible("memory") && (
              <Card label="memory" accent="#10b981" alertLevel={memAlert} icon={<IconMemory />}
                animDelay={50} expanded={expandedCard === "memory"} onToggle={() => toggleCard("memory")}>
                {loading ? <Skeleton /> : (
                  <>
                    <ThreeSegmentDonut
                      usedBytes={realMemUsed ?? 0}
                      cacheBytes={metrics?.memory.sReclaimable ?? 0}
                      freeBytes={metrics?.memory.available ?? 0}
                      totalBytes={memTotal ?? 0}
                      du={du}
                    />
                    {expandedCard === "memory" && (() => {
                      const s = histStats(memHistory);
                      return (
                        <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid #181818" }}>
                          <StatRow label="total"    value={fmtBytes(memTotal, 1, du)} />
                          <StatRow label="min used" value={s.min != null ? fmtPct(s.min) : "—"} />
                          <StatRow label="max used" value={s.max != null ? fmtPct(s.max) : "—"} />
                          <StatRow label="avg used" value={s.avg != null ? fmtPct(s.avg) : "—"} />
                        </div>
                      );
                    })()}
                  </>
                )}
              </Card>
            )}

            {/* Filesystems */}
            {isVisible("filesystems") && (
              <Card label="filesystems" accent="#f59e0b" alertLevel={maxDiskAlert} icon={<IconDisk />}
                animDelay={100} expanded={expandedCard === "filesystems"} onToggle={() => toggleCard("filesystems")}>
                {loading ? <Skeleton /> : !metrics?.disks.length ? (
                  <span className="text-xs" style={{ color: "#444" }}>no filesystems found</span>
                ) : (() => {
                  const sorted = [...metrics.disks].sort((a, b) => b.total - a.total);
                  const largest = sorted[0];
                  const rest = sorted.slice(1);
                  const lvl = diskAlertLevel(largest.usedPct);
                  const col = lvl === "critical" ? "#ff1744" : lvl === "warning" ? "#ff9100" : barColor(largest.usedPct);
                  return (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-4">
                        <DonutChart used={largest.used} total={largest.total} color={col} size={72} />
                        <div className="flex flex-col gap-1 min-w-0">
                          <span className="text-xs font-medium truncate" style={{ color: lvl ? col : "#777" }}>
                            {largest.mountpoint}
                          </span>
                          <span className="text-[10px] tabular-nums" style={{ color: "#444" }}>
                            {fmtBytes(largest.used, 1, du)} / {fmtBytes(largest.total, 1, du)}
                          </span>
                          {expandedCard === "filesystems" && (
                            <span className="text-[10px]" style={{ color: "#2e2e2e" }}>
                              {fmtBytes(largest.avail, 1, du)} free
                            </span>
                          )}
                        </div>
                      </div>
                      {rest.length > 0 && (
                        <div className="flex flex-col gap-2">
                          {rest.map(disk => {
                            const l = diskAlertLevel(disk.usedPct);
                            const c = l === "critical" ? "#ff1744" : l === "warning" ? "#ff9100" : barColor(disk.usedPct);
                            return (
                              <div key={disk.mountpoint} className="flex flex-col gap-1">
                                <div className="flex justify-between items-baseline gap-2">
                                  <span className="text-xs font-medium truncate" style={{ color: l ? c : "#666", maxWidth: "55%" }}>
                                    {disk.mountpoint}
                                  </span>
                                  <span className="text-[10px] tabular-nums shrink-0" style={{ color: "#444" }}>
                                    {fmtBytes(disk.used, 1, du)} / {fmtBytes(disk.total, 1, du)}
                                  </span>
                                </div>
                                <GaugeBar percent={disk.usedPct} color={c} thin />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </Card>
            )}

            {/* Network */}
            {isVisible("network") && (
              <Card label="network"
                subtitle={metrics?.network?.interfaceName ?? undefined}
                accent="#3b82f6" icon={<IconNetwork />}
                animDelay={150} expanded={expandedCard === "network"} onToggle={() => toggleCard("network")}>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium" style={{ color: "#3b82f6" }}>↓</span>
                    <span className="text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>rx</span>
                    <span className="text-xs font-medium tabular-nums ml-auto font-mono" style={{ color: "rgba(255,255,255,0.7)" }}>
                      {loading ? "—" : `${fmtBytes(metrics?.network.rxBytesPerSec ?? null, 1, du)}/s`}
                    </span>
                  </div>
                  <Sparkline data={rxHistory} color="#3b82f6" autoMax height={36} />
                  <span className="text-[10px] tabular-nums" style={{ color: "#2a2a2a" }}>
                    {fmtBytes(metrics?.network.rxBytesTotal ?? null, 1, du)} total
                  </span>
                </div>
                <div style={{ height: 1, background: "#161616" }} />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium" style={{ color: "#f59e0b" }}>↑</span>
                    <span className="text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>tx</span>
                    <span className="text-xs font-medium tabular-nums ml-auto font-mono" style={{ color: "rgba(255,255,255,0.7)" }}>
                      {loading ? "—" : `${fmtBytes(metrics?.network.txBytesPerSec ?? null, 1, du)}/s`}
                    </span>
                  </div>
                  <Sparkline data={txHistory} color="#f59e0b" autoMax height={36} />
                  <span className="text-[10px] tabular-nums" style={{ color: "#2a2a2a" }}>
                    {fmtBytes(metrics?.network.txBytesTotal ?? null, 1, du)} total
                  </span>
                </div>
                {expandedCard === "network" && rxHistory.length > 0 && (
                  <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid #181818" }}>
                    <StatRow label="peak rx" value={`${fmtBytes(Math.max(...rxHistory), 1, du)}/s`} />
                    <StatRow label="peak tx" value={`${fmtBytes(Math.max(...txHistory), 1, du)}/s`} />
                  </div>
                )}
              </Card>
            )}

            {/* GPU */}
            {isVisible("gpu") && (
              <Card label="gpu"
                subtitle={loading ? undefined : (metrics?.gpu?.name ?? "NVIDIA GPU")}
                accent={gpuColor} alertLevel={gpuTempAlert} icon={<IconGPU />}
                animDelay={200} expanded={expandedCard === "gpu"} onToggle={() => toggleCard("gpu")}>
                {loading ? <Skeleton /> : (
                  <>
                    <div className="flex items-baseline justify-between">
                      <BigValue value={fmtPct(gpuUtil)} />
                      {metrics?.gpu?.temperature != null && (
                        <span className="text-sm font-medium tabular-nums"
                          style={{ color: tempColor(metrics.gpu.temperature) }}>
                          {fmtTemp(metrics.gpu.temperature, tu)}
                        </span>
                      )}
                    </div>
                    <MiniBarChart data={gpuHistory} color={gpuColor} height={32} />
                    <LabeledBar
                      label="vram"
                      right={`${fmtBytes(metrics?.gpu?.memUsed ?? null, 1, du)} / ${fmtBytes(metrics?.gpu?.memTotal ?? null, 1, du)}`}
                      percent={gpuMemPct}
                      color={barColor(gpuMemPct)}
                    />
                    {metrics?.gpu?.powerDraw != null && metrics?.gpu?.powerLimit != null && (
                      <LabeledBar
                        label="power"
                        right={`${metrics.gpu.powerDraw.toFixed(1)} / ${metrics.gpu.powerLimit.toFixed(0)} W`}
                        percent={gpuPwrPct}
                        color={barColor(gpuPwrPct)}
                      />
                    )}
                    {metrics?.gpu?.powerDraw != null && metrics?.gpu?.powerLimit == null && (
                      <SubRow label="power draw" value={`${metrics.gpu.powerDraw.toFixed(1)} W`} />
                    )}
                    {/* temp sparkline — always visible */}
                    {gpuTempHistory.length >= 2 && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] uppercase tracking-widest" style={{ color: "#333" }}>temp</span>
                          {metrics?.gpu?.temperature != null && (
                            <span className="text-[10px] tabular-nums" style={{ color: tempColor(metrics.gpu.temperature) }}>
                              {fmtTemp(metrics.gpu.temperature, tu)}
                            </span>
                          )}
                        </div>
                        <Sparkline data={gpuTempHistory}
                          color={metrics?.gpu?.temperature != null ? tempColor(metrics.gpu.temperature) : "#555"}
                          autoMax height={24} />
                      </div>
                    )}
                    {expandedCard === "gpu" && (() => {
                      const s  = histStats(gpuHistory);
                      const ts = histStats(gpuTempHistory);
                      return (
                        <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid #181818" }}>
                          <StatRow label="util min" value={s.min != null ? fmtPct(s.min) : "—"} />
                          <StatRow label="util max" value={s.max != null ? fmtPct(s.max) : "—"} />
                          <StatRow label="util avg" value={s.avg != null ? fmtPct(s.avg) : "—"} />
                          <StatRow label="temp min" value={fmtTemp(ts.min ?? null, tu)} />
                          <StatRow label="temp max" value={fmtTemp(ts.max ?? null, tu)} />
                        </div>
                      );
                    })()}
                  </>
                )}
              </Card>
            )}

            {/* System Info — row 2 col 3 */}
            {isVisible("system") && (
              <Card label="system" accent="#d946ef" icon={<IconTerminal />}
                expanded={expandedCard === "system"} onToggle={() => toggleCard("system")}>
                {loading ? <Skeleton /> : (
                  <div className="flex flex-col gap-2.5">
                    <StatRow label="os"        value={metrics?.sysInfo?.os       ?? "—"} />
                    <StatRow label="kernel"    value={metrics?.sysInfo?.kernel   ?? "—"} />
                    <StatRow label="arch"      value={metrics?.sysInfo?.arch     ?? "—"} />
                    <StatRow label="hostname"  value={metrics?.sysInfo?.hostname ?? "—"} />
                    <StatRow label="cpu cores" value={metrics?.sysInfo?.cpuCores != null ? String(metrics.sysInfo.cpuCores) : "—"} />
                  </div>
                )}
              </Card>
            )}

            {/* Speedtest — spans all 3 columns */}
            {isVisible("speedtest") && (
              <div className="lg:col-span-3">
                <div
                  className="flex flex-col"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderTop: "2px solid #8b5cf6", minHeight: 220, borderRadius: 14,
                    animation: "fadeSlideIn 0.45s ease both", animationDelay: "250ms",
                    transition: "border-color 0.2s ease, transform 0.2s ease",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.transform = "translateY(0)"; }}
                >
                  {/* Card header */}
                  <div className="flex items-center gap-2 px-[18px] pt-[18px] pb-0">
                    <span style={{ color: "#8b5cf6", opacity: 0.8 }}><IconSpeedtest /></span>
                    <span className="text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em" }}>speedtest</span>
                    <button
                      className="ml-auto text-[9px]"
                      style={{ color: "rgba(255,255,255,0.2)", background: "none", border: "none", cursor: "pointer" }}
                      onClick={() => window.open("http://192.168.88.196:30220", "_blank")}
                    >↗</button>
                  </div>
                  {/* Card body */}
                  <div className="px-[18px] pt-3 pb-[18px] flex-1">
                    {speedtestLoading ? (
                      <div style={{ height: 100, display: "flex", alignItems: "center" }}><Skeleton /></div>
                    ) : !speedtestResults.length ? (
                      <div className="flex items-center gap-2" style={{ height: 80 }}>
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>no data · run a test at 192.168.88.196:30220</span>
                      </div>
                    ) : (() => {
                      const latest = speedtestResults[0];
                      const diff = latest.created_at ? (Date.now() - new Date(latest.created_at).getTime()) / 1000 : null;
                      const rel = diff == null ? null
                        : diff < 60 ? "just now"
                        : diff < 3600 ? `${Math.round(diff / 60)}m ago`
                        : diff < 86400 ? `${Math.round(diff / 3600)}h ago`
                        : `${Math.round(diff / 86400)}d ago`;
                      return (
                        <div className="flex gap-6" style={{ minHeight: 180 }}>
                          {/* LEFT: stats (1/3 width) */}
                          <div className="flex flex-col justify-between shrink-0" style={{ width: "33%" }}>
                            {latest.isp && (
                              <div className="flex flex-col gap-0.5 mb-2">
                                <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>{latest.isp}</span>
                                {latest.serverLocation && (
                                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{latest.serverLocation}</span>
                                )}
                              </div>
                            )}
                            <div className="flex flex-col gap-1">
                              <div className="flex flex-col">
                                <span className="font-medium tabular-nums" style={{ fontSize: 48, lineHeight: 1, color: "#00e5ff" }}>
                                  {latest.download != null ? latest.download.toFixed(0) : "—"}
                                </span>
                                <span className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Mbps ↓</span>
                              </div>
                              <div className="flex flex-col mt-1">
                                <span className="font-medium tabular-nums" style={{ fontSize: 38, lineHeight: 1, color: "#ff9100" }}>
                                  {latest.upload != null ? latest.upload.toFixed(0) : "—"}
                                </span>
                                <span className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>Mbps ↑</span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1 mt-2">
                              {latest.ping != null && (
                                <div className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ background: "#00e676", boxShadow: "0 0 4px #00e67666" }} />
                                  <span className="text-[11px] tabular-nums font-medium" style={{ color: "#00e676" }}>
                                    {latest.ping < 10 ? latest.ping.toFixed(1) : latest.ping.toFixed(0)} ms
                                  </span>
                                  <span className="text-[9px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.3)" }}>ping</span>
                                </div>
                              )}
                              {latest.jitter != null && (
                                <span className="text-[10px] tabular-nums" style={{ color: "rgba(255,255,255,0.4)" }}>
                                  {latest.jitter.toFixed(1)} ms jitter
                                </span>
                              )}
                              {rel && (
                                <span className="text-[10px] tabular-nums" style={{ color: "rgba(255,255,255,0.4)" }}>
                                  Last tested: {rel}
                                </span>
                              )}
                              <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                                auto-tests via SpeedTracker
                              </span>
                            </div>
                          </div>
                          {/* RIGHT: bar chart (2/3 width) */}
                          <div className="flex-1 min-w-0" style={{ height: 180 }}>
                            <SpeedtestBarChart results={speedtestResults} />
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}


          </div>

          {/* ── services (full width) ── */}
          {isVisible("services") && (
            <div className="flex flex-col gap-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 20 }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span style={{ color: "#8b5cf6", opacity: 0.8 }}><IconServices /></span>
                <span className="text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0.15em" }}>services</span>
                {services && (
                  <span style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "#10b981", fontWeight: 600 }}>
                    {services.filter(s => s.up).length} / {services.length} online
                  </span>
                )}
                {servicesUpdatedAt != null && (() => {
                  const sec = Math.round((Date.now() - servicesUpdatedAt) / 1000);
                  const rel = sec < 60 ? `${sec}s ago` : `${Math.round(sec / 60)}m ago`;
                  return <span className="text-[9px] ml-auto" style={{ color: "rgba(255,255,255,0.2)" }}>updated {rel}</span>;
                })()}
              </div>
              {servicesLoading ? <Skeleton /> : !services ? (
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>unavailable</span>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {services.map(({ name, up, lines, pct: svcPct, downCount }) => {
                    const color = SVC_COLORS[name] ?? "#666";
                    const icon  = SVC_ICONS[name]  ?? "";
                    const label = SVC_LABELS[name]  ?? name;
                    const url   = SVC_URLS[name];
                    return (
                      <div key={name}
                        className="flex flex-col gap-2 cursor-pointer"
                        onClick={() => url && window.open(url, "_blank")}
                        onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                        onMouseUp={e => (e.currentTarget.style.transform = "translateY(-2px)")}
                        style={{
                          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                          borderRadius: 12, padding: 14, minHeight: 100,
                          transition: "background 0.15s, transform 0.15s, border-color 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
                      >
                        <div className="flex items-center justify-between">
                          <ServiceIcon src={icon} label={label} color={color} />
                          <span className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse-dot"
                            style={{
                              background: up ? "#10b981" : "#ef4444",
                              boxShadow: up ? "0 0 5px #10b98155" : "0 0 4px #ef444455",
                              animation: up ? "pulseDot 2s ease-in-out infinite" : "none",
                            }} />
                        </div>
                        <span style={{ fontSize: 13, color: up ? "#ffffff" : "rgba(255,255,255,0.3)", fontWeight: 600 }}>{label}</span>
                        {up && lines.map((line, i) => (
                          <span key={i} style={{
                            color: name === "uptimekuma"
                              ? ((downCount ?? 0) > 0 ? "#ef4444" : "#10b981")
                              : "rgba(255,255,255,0.55)",
                            fontSize: 11, lineHeight: 1.6,
                          }}>{line}</span>
                        ))}
                        {!up && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>offline</span>}
                        {name === "radarr" && svcPct != null && up && (
                          <GaugeBar percent={svcPct} color={svcPct > 90 ? "#10b981" : svcPct > 70 ? "#f59e0b" : "#ef4444"} thin />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── bookmarks ── */}
          {showBookmarks && (
            <div className="flex flex-col gap-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "20px 24px" }}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase" style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.15em" }}>bookmarks</span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.18)", marginLeft: "auto" }}>H to toggle</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {BOOKMARKS.map(col => (
                  <div key={col.title} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 mb-2 pb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col.accentColor }} />
                      <span className="text-[9px] uppercase tracking-[0.18em]" style={{ color: col.accentColor, opacity: 0.8 }}>{col.title}</span>
                    </div>
                    {col.items.map(item => (
                      <BookmarkItem key={item.url + item.name} {...item} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── footer ── */}
          <div className="flex items-center justify-between flex-wrap gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center rounded" style={{ width: 16, height: 16, background: "rgba(251,146,60,0.2)", border: "1px solid rgba(251,146,60,0.3)", fontSize: 9, fontWeight: 700, color: "#fb923c" }}>C</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>built with claude code</span>
            </div>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.18)" }}>
              tracking {services?.length ?? 0} services · G search · R refresh · H bookmarks
            </span>
            <a href="http://192.168.88.196:30104" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.25)")}>
              prometheus ↗
            </a>
          </div>

        </div>
      </main>

      {showSettings && (
        <SettingsPanel settings={settings} onUpdate={setSettings} onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}
