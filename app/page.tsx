"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── lib imports ──────────────────────────────────────────────────────────────
import { THEMES, SVC_PORTS, normalizeTheme } from "@/app/lib/constants";
import type {
  Metrics, Settings, SpeedtestResult, SpeedtestRaw,
  ServiceResult, ActivityEvent, ForecastDay, ClientConfig, SearchEngine,
} from "@/app/lib/types";
import {
  fmtBytes, fmtTemp, fmtUptime, fmtSince, fmtPct,
  pct, barColor, gpuUtilColor, tempColor,
  normalizeSpeedResult, histStats, ageColor, withAlpha,
} from "@/app/lib/formatters";
import {
  cpuAlertLevel, memAlertLevel, diskAlertLevel, gpuTempAlertLevel,
  worstAlert,
} from "@/app/lib/alerts";
import { buildDemoMetrics, buildDemoServices } from "@/app/lib/demo-data";

// ── component imports ────────────────────────────────────────────────────────
import {
  IconCPU, IconMemory, IconDisk, IconNetwork, IconGPU,
  IconSpeedtest, IconTerminal, IconFolder,
  IconGear, IconTrueNAS,
} from "@/app/components/icons";
import {
  AnimatedNumber, animatedLine, TrendDelta, HeroStat,
  GaugeBar, Sparkline, RadialGauge, ThreeSegmentDonut, LabeledBar,
  Card, Skeleton, BigValue, StatRow,
} from "@/app/components/primitives";
import { SearchBar } from "@/app/components/SearchBar";
import { SettingsPanel } from "@/app/components/SettingsPanel";
import { MikrotikTab } from "@/app/components/MikrotikTab";
import { GrafanaCard } from "@/app/components/GrafanaCard";
import { ActivityFeed } from "@/app/components/ActivityFeed";
import { ComingUp } from "@/app/components/ComingUp";
import { NetworkChart } from "@/app/components/NetworkChart";
import { CpuThreads, busiestThreads } from "@/app/components/CpuThreads";
import { FilesystemsBody } from "@/app/components/FilesystemsBody";
import { DraggableCard } from "@/app/components/DraggableCard";
import { ContainerLogsSheet } from "@/app/components/ContainerLogsSheet";
import { CustomCardsGrid } from "@/app/components/CustomCards";
import { CustomCardEditor } from "@/app/components/CustomCardEditor";
import { ServicesPanel } from "@/app/components/ServicesPanel";
import { BookmarksPanel } from "@/app/components/BookmarksPanel";
import { KeyboardShortcuts } from "@/app/components/KeyboardShortcuts";
import { NotificationCenter } from "@/app/components/NotificationCenter";
import { HeaderSparklines } from "@/app/components/HeaderSparklines";
import { UptimeTimeline } from "@/app/components/UptimeTimeline";
import { CommandPalette, type CommandAction } from "@/app/components/CommandPalette";
import { DiskHealthPanel } from "@/app/components/DiskHealthPanel";
import { StatusSummary } from "@/app/components/StatusSummary";
import { NetworkTopology } from "@/app/components/NetworkTopology";
import { ServerFleetPanel } from "@/app/components/ServerFleetPanel";
import { DependencyMap } from "@/app/components/DependencyMap";
import { Clock } from "@/app/components/Clock";
import { ErrorBoundary } from "@/app/components/ErrorBoundary";
import { loadCardOrder, saveCardOrder, reorder } from "@/app/lib/card-order";
import { useEventStream } from "@/app/hooks/useEventStream";
import { usePollingInterval } from "@/app/hooks/usePolling";

// ── module constants ─────────────────────────────────────────────────────────

const MAX_HISTORY = 60;


const DEFAULT_SETTINGS: Settings = { refreshInterval: 10, tempUnit: "C", dataUnit: "decimal", visibleCards: {}, searchEngine: "google", timezone: "", theme: "midnight" };
const SETTINGS_KEY = "comexe:settings";

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  // window.location.href forces a full document reload; router.push does a
  // client-side transition. Next 16's no-location-assign-relative-destination
  // rule flags the former for internal routes.
  const router = useRouter();
  const [metrics,      setMetrics]      = useState<Metrics | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [lastUpdated,  setLastUpdated]  = useState<string>("");
  const [mounted,      setMounted]      = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [settings,     setSettings]     = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings,   setShowSettings]   = useState(false);
  const [expandedCards,  setExpandedCards]  = useState<ReadonlySet<string>>(() => new Set());
  const [offline,        setOffline]        = useState(false);
  const [showBookmarks,  setShowBookmarks]  = useState(true);
  const [alertsEnabled,  setAlertsEnabled]  = useState(false);
  const [alertCount,     setAlertCount]     = useState(0);   // session-level fire counter for the header pill
  const [showShortcuts,      setShowShortcuts]      = useState(false);
  const [showNotifications,  setShowNotifications]  = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showTopology,       setShowTopology]       = useState(false);
  const [showServerFleet,    setShowServerFleet]    = useState(false);
  const [showDependencyMap,  setShowDependencyMap]  = useState(false);
  const [serviceFilter,  setServiceFilter]  = useState("");
  const serviceFilterRef = useRef<HTMLInputElement>(null);
  const [versionInfo,    setVersionInfo]    = useState<{ current: string; latest: string | null; hasUpdate: boolean; repoUrl: string } | null>(null);
  const [updateDismissed,setUpdateDismissed]= useState(false);
  const [logsContainer,  setLogsContainer]  = useState<string | null>(null);
  const [restartingSvc,  setRestartingSvc]  = useState<string | null>(null);
  const [restartMsg,     setRestartMsg]     = useState<{ name: string; ok: boolean; text: string } | null>(null);

  // Hit /api/docker/restart and surface the result inline for a few seconds.
  const restartService = useCallback(async (containerName: string) => {
    setRestartingSvc(containerName);
    setRestartMsg(null);
    try {
      const res = await fetch("/api/docker/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: containerName }),
      });
      const body = await res.json();
      setRestartMsg({ name: containerName, ok: !!body.ok, text: body.message ?? (body.ok ? "Restarted" : "Failed") });
    } catch (e) {
      setRestartMsg({ name: containerName, ok: false, text: (e as Error).message });
    } finally {
      setRestartingSvc(null);
      setTimeout(() => setRestartMsg(null), 4000);
    }
  }, []);
  const [cardOrder,      setCardOrder]      = useState<string[]>(() => loadCardOrder());
  const reorderCards = useCallback((draggedKey: string, targetKey: string) => {
    setCardOrder(prev => {
      const next = reorder(prev, draggedKey, targetKey);
      saveCardOrder(next);
      return next;
    });
  }, []);
  const orderIndex = useCallback((key: string) => {
    const i = cardOrder.indexOf(key);
    return i < 0 ? 999 : i;
  }, [cardOrder]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [cpuHistory,     setCpuHistory]     = useState<number[]>([]);
  const [memHistory,     setMemHistory]     = useState<number[]>([]);
  const [gpuHistory,     setGpuHistory]     = useState<number[]>([]);
  const [gpuTempHistory, setGpuTempHistory] = useState<number[]>([]);
  const [rxHistory,      setRxHistory]      = useState<number[]>([]);
  const [txHistory,      setTxHistory]      = useState<number[]>([]);
  // When each rx/tx sample was taken, for the network chart's hover readout.
  const [netTimes,       setNetTimes]       = useState<number[]>([]);
  const [uptimeHistory,  setUptimeHistory]  = useState<{ ts: number; up: boolean }[]>([]);

  const [weather,            setWeather]            = useState<{ temp: number | null; condition: string | null; forecast?: ForecastDay[] } | null>(null);
  const [services,           setServices]           = useState<ServiceResult[] | null>(null);
  const [servicesLoading,    setServicesLoading]    = useState(true);
  const [servicesUpdatedAt,  setServicesUpdatedAt]  = useState<number | null>(null);
  const [activityEvents,     setActivityEvents]     = useState<ActivityEvent[]>([]);
  const [activityLoading,    setActivityLoading]    = useState(true);
  const [clientConfig,       setClientConfig]       = useState<ClientConfig | null>(null);
  const [speedtestResults,    setSpeedtestResults]    = useState<SpeedtestResult[]>([]);
  const [speedtestLoading,    setSpeedtestLoading]    = useState(true);
  const [speedtestHistory,    setSpeedtestHistory]    = useState<number[]>([]);
  const [speedtestTotalTests, setSpeedtestTotalTests] = useState<number | null>(null);

  const demoMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";

  useEffect(() => { setMounted(true); }, []);

  // Register service worker for offline PWA shell + offline detection
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const goOffline = () => setOffline(true);
    const goOnline  = () => setOffline(false);
    setOffline(!navigator.onLine);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online",  goOnline);
    return () => { window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); };
  }, []);

  // Demo mode — seed with fake data
  useEffect(() => {
    if (!demoMode) return;
    setMetrics(buildDemoMetrics());
    setLoading(false);
    setServices(buildDemoServices());
    setServicesLoading(false);
    setCpuHistory([38, 41, 35, 42, 44, 39, 40, 43, 42, 38, 36, 42]);
    setMemHistory([52, 53, 51, 54, 53, 55, 54, 52, 53, 55, 54, 53]);
    setGpuHistory([22, 25, 28, 30, 26, 24, 28, 31, 27, 25, 28, 28]);
    setGpuTempHistory([48, 49, 50, 51, 52, 51, 50, 52, 53, 52, 51, 52]);
    setRxHistory([20e6, 22e6, 18e6, 24e6, 21e6, 25e6, 23e6, 24e6, 22e6, 24e6]);
    setTxHistory([2.5e6, 3e6, 2.8e6, 3.2e6, 2.9e6, 3.5e6, 3.1e6, 3.2e6, 2.7e6, 3.2e6]);
    setNetTimes(Array.from({ length: 10 }, (_, i) => Date.now() - (9 - i) * 10_000));
    setWeather({ temp: 18, condition: "Partly cloudy", forecast: [
      { date: "2026-05-13", high: 20, low: 12, code: 2, condition: "Partly cloudy", emoji: "⛅" },
      { date: "2026-05-14", high: 17, low: 10, code: 61, condition: "Light rain", emoji: "🌧️" },
      { date: "2026-05-15", high: 22, low: 13, code: 0, condition: "Clear sky", emoji: "☀️" },
    ] });
    setSpeedtestResults([
      { ping: 8.2, download: 450, upload: 42, created_at: new Date().toISOString(), timestamp: null, isp: "Telstra", jitter: 1.2, serverName: "Sydney", serverLocation: "Sydney, AU", serverHost: "speedtest.syd.example.com" },
      { ping: 9.1, download: 440, upload: 40, created_at: new Date(Date.now() - 3600000).toISOString(), timestamp: null, isp: "Telstra", jitter: 1.5, serverName: "Sydney", serverLocation: "Sydney, AU", serverHost: "speedtest.syd.example.com" },
    ]);
    setSpeedtestLoading(false);
    setSpeedtestHistory([430, 445, 450, 440, 455, 448, 450]);
    setSpeedtestTotalTests(142);
    setActivityEvents([
      { type: "grabbed", title: "The Bear S04E08", source: "sonarr", timestamp: Date.now() - 300000, subtitle: "WEBDL-1080p" },
      { type: "imported", title: "Dune: Part Two", source: "radarr", timestamp: Date.now() - 1200000, subtitle: "Bluray-2160p" },
      { type: "watched", title: "Shogun S02E04", source: "tautulli", timestamp: Date.now() - 60000, subtitle: "alex" },
    ]);
    setActivityLoading(false);
  }, [demoMode]);

  // Persist settings to localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setSettings(s => ({ ...s, ...parsed, theme: normalizeTheme(parsed.theme ?? s.theme) }));
      }
    } catch { /* corrupt or empty — use defaults */ }
  }, []);
  // `settings === DEFAULT_SETTINGS` means nothing has been loaded or chosen yet.
  // Writing then saved the defaults over what the browser had stored before
  // the load above landed (React dev runs effects twice, so the second load
  // read the defaults back), and blocked the server-side preferences from
  // applying because localStorage was never empty again.
  useEffect(() => {
    if (settings === DEFAULT_SETTINGS) return;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* quota exceeded — ignore */ }
  }, [settings]);

  // Apply theme class to <html>. Same guard: on the untouched defaults this
  // would strip the class layout.tsx's pre-hydration script set (a saved
  // theme, or Paper from prefers-color-scheme) and flash Midnight.
  useEffect(() => {
    if (settings === DEFAULT_SETTINGS) return;
    const root = document.documentElement;
    THEMES.forEach(t => root.classList.remove(`theme-${t.key}`));
    if (settings.theme && settings.theme !== "midnight") {
      root.classList.add(`theme-${settings.theme}`);
    }
  }, [settings]);

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
      setNetTimes(h => [...h, data.timestamp ?? Date.now()].slice(-MAX_HISTORY));
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());
      setUptimeHistory(h => [...h, { ts: Date.now(), up: true }].slice(-300));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
      setUptimeHistory(h => [...h, { ts: Date.now(), up: false }].slice(-300));
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

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const events: ActivityEvent[] = Array.isArray(data.events) ? data.events : [];
      setActivityEvents(events);
    } catch {
      setActivityEvents(prev => prev);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const fetchSpeedtest = useCallback(async () => {
    try {
      const res = await fetch("/api/speedtest", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const raw: SpeedtestRaw[] = data.results ?? [];
      setSpeedtestResults(raw.map(normalizeSpeedResult));
      if (Array.isArray(data.history))    setSpeedtestHistory(data.history);
      if (data.totalTests != null)        setSpeedtestTotalTests(data.totalTests);
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
      if (data.ok !== false && !data.error) setWeather({ temp: data.temp, condition: data.condition, forecast: data.forecast ?? [] });
    } catch { /* weather is non-critical */ }
  }, []);

  // ── Alerts ────────────────────────────────────────────────────────────────
  // The server's background collector evaluates thresholds and sends webhooks
  // whether or not this tab exists. The tab only counts fires and raises
  // browser notifications for the ones it hears about — over SSE while
  // connected, or by polling GET /api/alerts in fallback mode.
  const alertsBrowserNotifRef = useRef(true);
  // Fires from before this page loaded aren't news; set on mount.
  const lastAlertTsRef = useRef(0);
  useEffect(() => { lastAlertTsRef.current = Date.now(); }, []);
  const handleAlertFires = useCallback((fires: { key: string; ts: number; level: "warning" | "critical"; msg: string }[]) => {
    const fresh = fires.filter(f => f.ts > lastAlertTsRef.current);
    if (fresh.length === 0) return;
    lastAlertTsRef.current = Math.max(...fresh.map(f => f.ts));
    setAlertCount(c => c + fresh.length);

    // Only when the tab isn't in focus — a visible tab already shows the pill.
    if (alertsBrowserNotifRef.current && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
      for (const f of fresh) {
        try {
          new Notification(`ComExe · ${f.level === "critical" ? "critical" : "warning"}`, { body: f.msg, tag: f.key, icon: "/icon.svg" });
        } catch { /* some browsers reject if not in user gesture; ignore */ }
      }
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) return;
      const d = await res.json();
      if (Array.isArray(d.recent)) handleAlertFires(d.recent);
    } catch { /* alerts shouldn't break the dashboard */ }
  }, [handleAlertFires]);

  // ── SSE live updates ──────────────────────────────────────────────────────
  const handleSSE = useCallback((event: string, data: unknown) => {
    switch (event) {
      case "metrics": {
        const m = data as Metrics;
        setMetrics(m);
        if (m.cpu != null) setCpuHistory(h => [...h, m.cpu!].slice(-MAX_HISTORY));
        const realUsed = m.memory.total != null && m.memory.available != null
          ? Math.max(0, m.memory.total - m.memory.available - (m.memory.sReclaimable ?? 0)) : null;
        setMemHistory(h => [...h, pct(realUsed, m.memory.total)].slice(-MAX_HISTORY));
        if (m.gpu?.utilization != null) setGpuHistory(h => [...h, m.gpu.utilization!].slice(-MAX_HISTORY));
        if (m.gpu?.temperature != null) setGpuTempHistory(h => [...h, m.gpu.temperature!].slice(-MAX_HISTORY));
        setRxHistory(h => [...h, m.network.rxBytesPerSec ?? 0].slice(-MAX_HISTORY));
        setTxHistory(h => [...h, m.network.txBytesPerSec ?? 0].slice(-MAX_HISTORY));
        setNetTimes(h => [...h, m.timestamp ?? Date.now()].slice(-MAX_HISTORY));
        setError(null); setLoading(false); setLastUpdated(new Date().toLocaleTimeString());
        setRefreshing(true); setTimeout(() => setRefreshing(false), 800);
        setUptimeHistory(h => [...h, { ts: Date.now(), up: true }].slice(-300));
        break;
      }
      case "services": {
        const d = data as { services?: ServiceResult[] | null };
        setServices(d.services ?? null);
        setServicesUpdatedAt(Date.now());
        setServicesLoading(false);
        break;
      }
      case "activity": {
        const d = data as { events?: ActivityEvent[] };
        setActivityEvents(Array.isArray(d.events) ? d.events : []);
        setActivityLoading(false);
        break;
      }
      case "speedtest": {
        const d = data as { results?: SpeedtestRaw[]; history?: number[]; totalTests?: number };
        const raw: SpeedtestRaw[] = d.results ?? [];
        setSpeedtestResults(raw.map(normalizeSpeedResult));
        if (Array.isArray(d.history)) setSpeedtestHistory(d.history);
        if (d.totalTests != null) setSpeedtestTotalTests(d.totalTests);
        setSpeedtestLoading(false);
        break;
      }
      case "weather": {
        const d = data as { ok?: boolean; error?: boolean; temp?: number; condition?: string; forecast?: ForecastDay[] };
        if (d.ok !== false && !d.error) setWeather({ temp: d.temp ?? null, condition: d.condition ?? null, forecast: d.forecast ?? [] });
        break;
      }
      case "alert": {
        const d = data as { fires?: { key: string; ts: number; level: "warning" | "critical"; msg: string }[] };
        if (Array.isArray(d.fires)) handleAlertFires(d.fires);
        break;
      }
    }
  }, [handleAlertFires]);

  // CRITICAL: this object must be memoized. A fresh literal every render
  // would make useEventStream's connect callback churn, tearing down and
  // re-opening the SSE EventSource on every Dashboard render (the 1Hz
  // clock alone causes one render/sec). Each new connection refetches
  // ALL 6 upstream endpoints immediately — past versions of this code
  // were hammering radarr/sonarr/prowlarr with hundreds of requests/min
  // from a single tab. Keep the dep list to primitive values only.
  const sseIntervals = useMemo(() => ({
    metrics:  (settings.refreshOverrides?.metrics  || settings.refreshInterval) * 1000,
    services: (settings.refreshOverrides?.services || 30) * 1000,
    mikrotik: (settings.refreshOverrides?.mikrotik || 15) * 1000,
    activity: (settings.refreshOverrides?.activity || 120) * 1000,
    speedtest: 600000,
    weather:   600000,
  }), [
    settings.refreshOverrides?.metrics,
    settings.refreshOverrides?.services,
    settings.refreshOverrides?.mikrotik,
    settings.refreshOverrides?.activity,
    settings.refreshInterval,
  ]);

  const { fallback: usePolling } = useEventStream({
    enabled: !demoMode,
    intervals: sseIntervals,
    onMessage: handleSSE,
  });

  // Clock lives in its own <Clock> component so its 1Hz tick re-renders only
  // the header time, not this entire Dashboard tree (see app/components/Clock.tsx).

  // Polling effects — only active when SSE is unavailable (fallback mode).
  // usePollingInterval also suspends these whenever the tab is hidden and
  // fires once on return; see app/hooks/usePolling.ts.
  const pollActive = !demoMode && usePolling;
  usePollingInterval(fetchWeather,   600_000,                                                  { enabled: pollActive });
  usePollingInterval(fetchServices,  (settings.refreshOverrides?.services || 30)  * 1000,       { enabled: pollActive });
  usePollingInterval(fetchSpeedtest, 300_000,                                                  { enabled: pollActive });
  usePollingInterval(fetchActivity,  (settings.refreshOverrides?.activity || 60)  * 1000,       { enabled: pollActive });
  usePollingInterval(fetchAlerts,    60_000, { enabled: pollActive && alertsEnabled, skipImmediate: true });

  // Load alert config on mount — decides whether the header pill shows and
  // whether fires raise browser notifications.
  useEffect(() => {
    fetch("/api/alerts")
      .then(r => r.json())
      .then(d => {
        const notif = d.config?.browserNotifications !== false;
        alertsBrowserNotifRef.current = notif;
        setAlertsEnabled(!!d.config?.enabled);
      })
      .catch(() => {});
  }, []);

  // Check for new image release once on mount + every 30 min. Dismissal is
  // stored per-SHA in localStorage: dismissing hides the banner for THAT
  // release only, so it stays gone across reloads but re-appears when a newer
  // image lands.
  useEffect(() => {
    let cancelled = false;
    function check() {
      fetch("/api/version")
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          setVersionInfo({ current: d.current, latest: d.latest, hasUpdate: !!d.hasUpdate, repoUrl: d.repoUrl });
          setUpdateDismissed(!!d.latest && localStorage.getItem("comexe:update-dismissed") === d.latest);
        })
        .catch(() => {});
    }
    check();
    const id = setInterval(check, 30 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Client config — fetched once on mount
  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((cfg: ClientConfig | null) => {
        if (!cfg) return;
        setClientConfig(cfg);
        if (cfg.preferences) {
          setSettings(prev => {
            const saved = localStorage.getItem(SETTINGS_KEY);
            const hasSavedEngine = saved && JSON.parse(saved).searchEngine;
            const hasSavedTz     = saved && JSON.parse(saved).timezone !== undefined;
            const hasSavedTheme  = saved && JSON.parse(saved).theme;
            return {
              ...prev,
              searchEngine: hasSavedEngine ? prev.searchEngine : (cfg.preferences!.searchEngine as SearchEngine) || prev.searchEngine,
              timezone:     hasSavedTz     ? prev.timezone     : cfg.preferences!.timezone ?? prev.timezone,
              theme:        hasSavedTheme  ? prev.theme        : normalizeTheme(cfg.preferences!.theme || prev.theme),
            };
          });
        }
      })
      .catch(() => {});
  }, []);

  // First-run redirect
  useEffect(() => {
    if (demoMode) return;
    if (!services || servicesLoading) return;
    const configured = services.filter(s => s.configured !== false).length;
    if (configured === 0 && !localStorage.getItem("comexe:welcome-done")) {
      router.push("/welcome");
    }
  }, [services, servicesLoading, demoMode, router]);

  usePollingInterval(
    fetchMetrics,
    (settings.refreshOverrides?.metrics || settings.refreshInterval) * 1000,
    { enabled: pollActive },
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "Escape") { setShowSettings(false); setShowShortcuts(false); setShowNotifications(false); setShowCommandPalette(false); setExpandedCards(new Set()); (e.target as HTMLElement)?.blur?.(); return; }
      if (isTyping) return;
      if (e.key === "?")                  { e.preventDefault(); setShowShortcuts(v => !v); }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); fetchMetrics(); }
      if (e.key === "g" || e.key === "G") { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === "h" || e.key === "H") setShowBookmarks(v => !v);
      if (e.key === "/")                  { e.preventDefault(); serviceFilterRef.current?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setShowCommandPalette(v => !v); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fetchMetrics]);

  // ── derived state ──────────────────────────────────────────────────────────
  const cpuPct      = pct(metrics?.cpu ?? null, 100);
  const memTotal    = metrics?.memory.total ?? null;
  const realMemUsed = memTotal != null && metrics?.memory.available != null
    ? Math.max(0, memTotal - metrics.memory.available - (metrics.memory.sReclaimable ?? 0)) : null;
  const realMemPct  = pct(realMemUsed, memTotal);
  const gpuUtil     = metrics?.gpu?.utilization ?? null;
  const gpuMemPct   = pct(metrics?.gpu?.memUsed ?? null, metrics?.gpu?.memTotal ?? null);
  const gpuPwrPct   = pct(metrics?.gpu?.powerDraw ?? null, metrics?.gpu?.powerLimit ?? null);
  const gpuColor    = gpuUtil != null ? gpuUtilColor(gpuUtil, "var(--accent-gpu)") : "var(--accent-gpu)";

  const cpuAlert     = cpuAlertLevel(metrics?.cpu ?? null);
  const memAlert     = memAlertLevel(metrics?.memory.total ?? null, metrics?.memory.available ?? null, metrics?.memory.sReclaimable ?? null);
  const gpuTempAlert = gpuTempAlertLevel(metrics?.gpu?.temperature ?? null);
  const maxDiskAlert = worstAlert(metrics?.disks.map(d => diskAlertLevel(d.usedPct)) ?? []);

  const isVisible  = (k: string) => settings.visibleCards[k] !== false;
  // Each card expands on its own: opening one leaves the others as they are.
  const toggleCard = (k: string) => setExpandedCards(prev => {
    const next = new Set(prev);
    if (!next.delete(k)) next.add(k);
    return next;
  });
  const isExpanded = (k: string) => expandedCards.has(k);
  const du = settings.dataUnit;
  const tu = settings.tempUnit;

  const commandActions = useMemo<CommandAction[]>(() => [
    { id: "refresh", label: "Refresh metrics", shortcut: "R", section: "Actions", action: () => fetchMetrics() },
    { id: "search", label: "Focus search bar", shortcut: "G", section: "Actions", action: () => searchInputRef.current?.focus() },
    { id: "filter", label: "Focus service filter", shortcut: "/", section: "Actions", action: () => serviceFilterRef.current?.focus() },
    { id: "bookmarks", label: "Toggle bookmarks", shortcut: "H", section: "Actions", action: () => setShowBookmarks(v => !v) },
    { id: "settings", label: "Open settings", section: "Panels", action: () => setShowSettings(true) },
    { id: "shortcuts", label: "Keyboard shortcuts", shortcut: "?", section: "Panels", action: () => setShowShortcuts(true) },
    { id: "notifications", label: "Notifications", section: "Panels", action: () => setShowNotifications(true) },
    { id: "topology", label: "Network topology", section: "Panels", action: () => setShowTopology(true) },
    { id: "fleet", label: "Server fleet", section: "Panels", action: () => setShowServerFleet(true) },
    { id: "dependencies", label: "Dependency map", section: "Panels", action: () => setShowDependencyMap(true) },
    { id: "analytics", label: "Open analytics", section: "Navigate", action: () => { router.push("/analytics"); } },
    { id: "logs", label: "Log viewer", section: "Navigate", action: () => { router.push("/logs"); } },
    { id: "forecast", label: "Insights & forecasting", section: "Navigate", action: () => { router.push("/forecast"); } },
    { id: "setup", label: "Setup wizard", section: "Navigate", action: () => { router.push("/setup"); } },
    { id: "truenas", label: "Open TrueNAS UI", section: "Navigate", action: () => window.open(`http://${clientConfig?.truenasIp ?? "192.168.88.196"}`, "_blank") },
    { id: "prometheus", label: "Open Prometheus", section: "Navigate", action: () => window.open(`http://${clientConfig?.truenasIp ?? "192.168.88.196"}:30104`, "_blank") },
  ], [fetchMetrics, clientConfig?.truenasIp, router]);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* top loading bar */}
      <div className="fixed top-0 left-0 right-0 z-50" style={{ height: 2 }}>
        <div style={{
          height: "100%",
          background: "linear-gradient(90deg, var(--settings-active), var(--ok))",
          boxShadow: "0 0 8px var(--settings-active)66",
          transition: refreshing ? "width 0.5s ease" : "width 0.8s ease, opacity 0.5s ease 0.3s",
          width: refreshing ? "80%" : loading ? "35%" : "100%",
          opacity: (refreshing || loading) ? 1 : 0,
        }} />
      </div>
      {/* Demo mode banner */}
      {demoMode && mounted && (
        <div className="fixed top-0 left-0 right-0 z-50 text-center" style={{
          background: "var(--warn)",
          padding: "4px 0", fontSize: 12, fontWeight: 600, color: "#0a0c12",
          letterSpacing: "0.02em",
        }}>
          Demo mode — showing sample data.{" "}
          {/* Deliberately a full reload, not router.push. demoMode is derived
              from window.location.search during render, and every demo-seeded
              piece of state (metrics, services, history arrays) was set by a
              one-shot effect. A client-side transition would change the URL
              while leaving that state in place. Reloading is the honest reset. */}
          <span style={{ textDecoration: "underline", fontWeight: 700, cursor: "pointer" }}
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            onClick={() => { window.location.href = "/"; }}>Exit demo</span>
        </div>
      )}

      {/* Update-available banner — only shows when image SHA differs from
          main HEAD on GitHub. Hidden during demo to avoid confusing the
          showcase flow. */}
      {!demoMode && mounted && versionInfo?.hasUpdate && !updateDismissed && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3" style={{
          background: "var(--brand)",
          padding: "4px 12px", fontSize: 12, fontWeight: 600, color: "#0a0c12",
          letterSpacing: "0.02em",
        }}>
          <span>
            ComExe update available — running <code style={{ fontFamily: "monospace" }}>{versionInfo.current.slice(0, 7)}</code>, latest{" "}
            <a href={`${versionInfo.repoUrl}/commits/main`} target="_blank" rel="noopener noreferrer"
              style={{ color: "#0a0c12", textDecoration: "underline", fontWeight: 700 }}>
              {versionInfo.latest?.slice(0, 7)}
            </a>. Run <code style={{ fontFamily: "monospace" }}>update-dashboard.sh</code> to pull.
          </span>
          <button onClick={() => {
            setUpdateDismissed(true);
            if (versionInfo.latest) try { localStorage.setItem("comexe:update-dismissed", versionInfo.latest); } catch {}
          }}
            style={{ background: "transparent", border: "none", color: "#0a0c12", fontSize: 14, cursor: "pointer", padding: "0 6px", lineHeight: 1, fontWeight: 700 }}
            aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ── sticky frosted header ── */}
      <header className="fixed top-0 left-0 right-0 z-30" style={{
        background: "var(--header-bg)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <div className="header-inner max-w-5xl mx-auto px-6 sm:px-6 py-2.5 flex items-center justify-between gap-4">
          {/* Left */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link href="/" className="flex items-center gap-2 shrink-0" style={{ textDecoration: "none" }}>
              <svg width="22" height="22" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                <path d="M14 8 A 8 8 0 1 0 14 24" style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
                <path d="M19 8 L25 8"   style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
                <path d="M19 8 L19 24"  style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
                <path d="M19 16 L24 16" style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
                <path d="M19 24 L25 24" style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
              </svg>
              <h1 className="font-mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
                Com<span style={{ color: "var(--brand)" }}>Exe</span>
              </h1>
            </Link>
            <nav aria-label="Pages" className="hidden md:flex items-center shrink-0" style={{ gap: 16, marginLeft: 12, fontSize: 13 }}>
              <Link href="/" aria-current="page" style={{ color: "var(--text)", fontWeight: 500, textDecoration: "none" }}>Dashboard</Link>
              {[["/analytics", "Analytics"], ["/forecast", "Forecast"], ["/logs", "Logs"]].map(([href, text]) => (
                <Link key={href} href={href} style={{ color: "var(--text-muted)", textDecoration: "none" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "var(--text)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}>{text}</Link>
              ))}
            </nav>
            {metrics?.uptime != null && (
              <span className="hidden md:flex items-center gap-1.5 shrink-0" style={{ background: "var(--surface)", border: "1px solid var(--border-bright)", borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                {fmtUptime(metrics.uptime)}
                <span style={{ color: "var(--text-faint)" }}>·</span>
                <span style={{ color: "var(--text-label)", fontSize: 12 }}>{fmtSince(metrics.uptime)}</span>
              </span>
            )}
            {weather && (
              <span className="shrink-0 hidden sm:inline" style={{ position: "relative" }}>
                <span
                  className="peer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    background: "var(--surface)", border: "1px solid var(--border-bright)",
                    borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "var(--text-secondary)",
                    fontVariantNumeric: "tabular-nums",
                    cursor: weather.forecast?.length ? "default" : undefined,
                  }}
                >
                  {weather.temp != null ? `${tu === "F" ? `${(weather.temp * 9/5 + 32).toFixed(0)}°F` : `${weather.temp.toFixed(0)}°C`}` : ""}
                  {weather.condition ? ` · ${weather.condition}` : ""}
                  {weather.forecast?.length ? (
                    <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.4 }}><path d="M2 3l2 2.5L6 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : null}
                </span>
                {weather.forecast && weather.forecast.length > 0 && (
                  <div
                    className="absolute left-0 opacity-0 pointer-events-none peer-hover:opacity-100 peer-hover:pointer-events-auto hover:opacity-100 hover:pointer-events-auto"
                    style={{
                      top: "calc(100% + 6px)", zIndex: 50, minWidth: 200,
                      background: "var(--settings-bg)", border: "1px solid var(--border-mid)",
                      borderRadius: 10, padding: "10px 12px",
                      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                      transition: "opacity 0.15s ease",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "var(--text-label)", marginBottom: 8, fontWeight: 600 }}>3-day forecast</div>
                    <div className="flex flex-col gap-1.5">
                      {weather.forecast.map((d, i) => (
                        <div key={i} className="flex items-center justify-between gap-4" style={{ fontSize: 12 }}>
                          <span style={{ color: "var(--text-muted)", minWidth: 28 }}>{d.date}</span>
                          <span className="flex-1" style={{ color: "var(--text-label)", fontSize: 12 }}>{d.condition}</span>
                          <span className="font-mono tabular-nums" style={{ color: "var(--text-secondary)" }}>
                            {tu === "F" ? `${Math.round(d.high * 9/5 + 32)}°` : `${d.high}°`}
                          </span>
                          <span className="font-mono tabular-nums" style={{ color: "var(--text-faint)" }}>
                            {tu === "F" ? `${Math.round(d.low * 9/5 + 32)}°` : `${d.low}°`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </span>
            )}
          </div>
          {/* Right */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <HeaderSparklines cpuHistory={cpuHistory} memHistory={memHistory} rxHistory={rxHistory} />
            <Clock timezone={settings.timezone} />
            {error && (
              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: "color-mix(in srgb, var(--critical) 10%, transparent)", color: "var(--critical)", border: "1px solid color-mix(in srgb, var(--critical) 20%, transparent)" }}>
                {error}
              </span>
            )}
            <span className="block w-1.5 h-1.5 rounded-full"
              style={{
                background: error ? "var(--critical)" : loading ? "var(--text-hidden)" : "var(--ok)",
              }} />
            {alertsEnabled && alertCount > 0 && (
              <button
                title={`${alertCount} alert${alertCount === 1 ? "" : "s"} this session — open notifications`}
                aria-label={`Open notifications (${alertCount} alert${alertCount === 1 ? "" : "s"})`}
                onClick={() => { setShowNotifications(true); setAlertCount(0); }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  fontSize: 12, fontWeight: 600,
                  color: "#fff",
                  background: alertCount > 0 ? "var(--critical)" : "transparent",
                  border: "none", borderRadius: 999,
                  padding: "2px 8px", cursor: "pointer",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
                {alertCount}
              </button>
            )}
            <Link href="/analytics" title="Analytics" aria-label="Open analytics" className="md:hidden flex items-center"
              style={{ color: "var(--text-ghost)", textDecoration: "none", padding: 2, transition: "color 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-ghost)")}
            ><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3v18h18"/><path d="M8 17v-5"/><path d="M13 17V8"/><path d="M18 17v-9"/></svg></Link>
            <button
              title="Open TrueNAS"
              aria-label="Open TrueNAS web UI"
              onClick={() => window.open(`http://${clientConfig?.truenasIp ?? "192.168.88.196"}`, "_blank")}
              style={{ color: "var(--text-ghost)", background: "none", border: "none", cursor: "pointer", padding: 2, transition: "color 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--brand)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-ghost)")}
            ><IconTrueNAS /></button>
            <button
              title="Settings"
              aria-label="Toggle settings panel"
              onClick={() => setShowSettings(v => !v)}
              style={{ color: showSettings ? "var(--text)" : "var(--text-ghost)", background: "none", border: "none", cursor: "pointer", padding: 2, transition: "color 0.2s" }}
            ><IconGear /></button>
          </div>
        </div>
      </header>

      <main
        className="w-full min-h-screen"
        style={{
          background: "var(--bg)",
          fontFamily: "'Inter', system-ui, sans-serif",
          opacity: mounted ? 1 : 0,
          transition: "opacity 0.5s ease-out",
        }}
      >
        <div className="main-content max-w-5xl mx-auto px-3 sm:px-6 pb-10 flex flex-col gap-4 sm:gap-6" style={{ paddingTop: 72 }}>

          <SearchBar inputRef={searchInputRef} engine={settings.searchEngine} />
          <ErrorBoundary name="MikroTik">
            <MikrotikTab mikrotikUrl={clientConfig?.mikrotikUrl ?? "http://192.168.88.1"} refreshSec={settings.refreshOverrides?.mikrotik} demoMode={demoMode} />
          </ErrorBoundary>
          {offline && (
            <div className="flex items-center gap-2" style={{
              background: "color-mix(in srgb, var(--warn) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--warn) 30%, transparent)",
              borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "var(--warn)",
            }}>
              <span style={{ fontSize: 14 }}>&#9888;</span>
              <span>You are offline — showing cached data. Updates will resume when connectivity returns.</span>
            </div>
          )}
          {/* What needs attention, in one place: thresholds, down/auth/health
              problems across services, stale data, Prometheus exporters. */}
          <StatusSummary metrics={metrics} services={services} servicesUpdatedAt={servicesUpdatedAt}
            clientConfig={clientConfig} demoMode={demoMode} />

          {/* First-run setup banner */}
          {services && (() => {
            const configuredCount = services.filter(s => s.configured !== false).length;
            const totalCount      = services.length;
            if (configuredCount >= 3 || configuredCount === totalCount) return null;
            const missingCount = totalCount - configuredCount;
            return (
              <div className="flex items-center gap-3 flex-wrap" style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "10px 14px",
              }}>
                
                <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
                  Welcome — {configuredCount === 0 ? "no services configured yet" : `only ${configuredCount} of ${totalCount} services configured`}.
                </span>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  {missingCount === 1 ? "1 service is" : `${missingCount} services are`} missing config. Try the{" "}
                  <a href="/setup" style={{ color: "var(--brand)", textDecoration: "underline", fontWeight: 600 }}>
                    setup wizard
                  </a>{" "}
                  to fill in URLs / API keys with live connection-testing, or check{" "}
                  <a href="https://github.com/syedhashmi-bit/ComExe/blob/main/INSTALL.md" target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--brand)", textDecoration: "underline" }}>
                    INSTALL.md
                  </a>.
                </span>
              </div>
            );
          })()}

          {/* Two columns from 1280px (metrics | Plex + services), one column
              below — see .dash-columns in globals.css. */}
          <div className="dash-columns">
            <div className="dash-main">
              {/* ── metric grid ── */}
              <div className="metric-grid">

                {/* CPU */}
                {isVisible("cpu") && (
                  <div style={{ order: orderIndex("cpu") }}><DraggableCard cardKey="cpu" onReorder={reorderCards}>
                  <Card label="cpu" accent="var(--accent-cpu)"
                    subtitle={!loading ? (metrics?.sysInfo?.cpuModel ?? undefined) : undefined}
                    alertLevel={cpuAlert} icon={<IconCPU />}
                    animDelay={0} expanded={isExpanded("cpu")} onToggle={() => toggleCard("cpu")}>
                    <div className="flex items-end justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <BigValue value={fmtPct(metrics?.cpu ?? null)} loading={loading} />
                        {!loading && metrics?.cpu != null && (
                          <TrendDelta history={cpuHistory} current={metrics.cpu} goodDirection="down" suffix="%" />
                        )}
                      </div>
                      {!loading && (
                        <div className="flex flex-wrap gap-1 mb-1 justify-end">
                          {metrics?.sysInfo?.cpuCores != null && (
                            <span className="tabular-nums" style={{
                              background: "var(--surface)", border: "1px solid var(--border)",
                              borderRadius: 5, padding: "2px 7px", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap",
                            }}>{metrics.sysInfo.cpuCores} cores</span>
                          )}
                          {metrics?.sysInfo?.cpuFreqGhz != null && (
                            <span className="tabular-nums font-mono" style={{
                              background: "var(--surface)", border: "1px solid var(--border)",
                              borderRadius: 5, padding: "2px 7px", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap",
                            }}>@ {metrics.sysInfo.cpuFreqGhz.toFixed(2)} GHz</span>
                          )}
                        </div>
                      )}
                    </div>
                    <Sparkline data={cpuHistory} color={barColor(cpuPct, "var(--accent-cpu)")} height={48} />
                    <GaugeBar percent={cpuPct} color={barColor(cpuPct, "var(--accent-cpu)")} />
                    {!loading && (metrics?.cpuThreads?.length ?? 0) > 1 && (
                      <CpuThreads threads={metrics!.cpuThreads!} />
                    )}
                    {!loading && (metrics?.sysInfo?.load1 != null) && (
                      <span className="text-xs tabular-nums font-mono" style={{ color: "var(--text-faint)" }}>
                        Load: {metrics.sysInfo.load1?.toFixed(2)} · {metrics.sysInfo.load5?.toFixed(2)} · {metrics.sysInfo.load15?.toFixed(2)}
                      </span>
                    )}
                    {isExpanded("cpu") && (() => {
                      const s = histStats(cpuHistory);
                      const busiest = busiestThreads(metrics?.cpuThreads ?? []);
                      return (
                        <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid var(--divider)" }}>
                          <StatRow label="Min" value={s.min != null ? fmtPct(s.min) : "—"} />
                          <StatRow label="Max" value={s.max != null ? fmtPct(s.max) : "—"} />
                          <StatRow label="Average" value={s.avg != null ? fmtPct(s.avg) : "—"} />
                          {busiest.length > 1 && (
                            <StatRow label="Busiest threads" value={busiest.map(b => `cpu${b.cpu} ${b.pct.toFixed(0)}%`).join(" · ")} />
                          )}
                        </div>
                      );
                    })()}
                  </Card>
                  </DraggableCard></div>
                )}

                {/* Memory */}
                {isVisible("memory") && (
                  <div style={{ order: orderIndex("memory") }}><DraggableCard cardKey="memory" onReorder={reorderCards}>
                  <Card label="memory" accent="var(--accent-memory)" alertLevel={memAlert} icon={<IconMemory />}
                    animDelay={50} expanded={isExpanded("memory")} onToggle={() => toggleCard("memory")}>
                    {loading ? <Skeleton /> : (
                      <>
                        <ThreeSegmentDonut
                          usedBytes={realMemUsed ?? 0}
                          cacheBytes={metrics?.memory.sReclaimable ?? 0}
                          freeBytes={metrics?.memory.available ?? 0}
                          totalBytes={memTotal ?? 0}
                          du={du}
                          usedColor={memAlert === "critical" ? "var(--critical)" : memAlert === "warning" ? "var(--warn)" : "var(--accent-memory)"}
                        />
                        {realMemPct > 0 && (
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-xs tabular-nums" style={{ color: "var(--text-faint)" }}>
                              Actual pressure: {realMemPct.toFixed(1)}%
                            </span>
                            <TrendDelta history={memHistory} current={realMemPct} goodDirection="down" suffix="%" />
                          </div>
                        )}
                        {isExpanded("memory") && (() => {
                          const s = histStats(memHistory);
                          return (
                            <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid var(--divider)" }}>
                              <StatRow label="Total"    value={fmtBytes(memTotal, 1, du)} />
                              <StatRow label="Min used" value={s.min != null ? fmtPct(s.min) : "—"} />
                              <StatRow label="Max used" value={s.max != null ? fmtPct(s.max) : "—"} />
                              <StatRow label="Avg used" value={s.avg != null ? fmtPct(s.avg) : "—"} />
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </Card>
                  </DraggableCard></div>
                )}

                {/* Filesystems */}
                {isVisible("filesystems") && (
                  <div style={{ order: orderIndex("filesystems") }}><DraggableCard cardKey="filesystems" onReorder={reorderCards}>
                  <Card label="filesystems" accent="var(--accent-fs)" alertLevel={maxDiskAlert} icon={<IconDisk />}
                    animDelay={100} expanded={isExpanded("filesystems")} onToggle={() => toggleCard("filesystems")}>
                    {loading ? <Skeleton /> : !metrics?.disks.length ? (
                      <span className="text-xs" style={{ color: "var(--text-faint)" }}>No filesystems found under {clientConfig?.fsPathPrefix ?? "the media path"}.</span>
                    ) : (
                      <FilesystemsBody metrics={metrics} du={du} fsPathPrefix={clientConfig?.fsPathPrefix ?? "/mnt/Pool/Media/"} />
                    )}
                  </Card>
                  </DraggableCard></div>
                )}

                {/* Network */}
                {isVisible("network") && (
                  <div style={{ order: orderIndex("network") }}><DraggableCard cardKey="network" onReorder={reorderCards}>
                  <Card label="network" accent="var(--accent-network)" icon={<IconNetwork />}
                    animDelay={150} expanded={isExpanded("network")} onToggle={() => toggleCard("network")}>
                    {!loading && metrics?.network?.interfaceName && (
                      <span className="self-start font-mono" style={{
                        background: "var(--surface)", border: "1px solid var(--border)",
                        borderRadius: 4, padding: "2px 7px", fontSize: 12, color: "var(--accent-network)",
                      }}>{metrics.network.interfaceName}</span>
                    )}
                    <div className="flex flex-wrap" style={{ columnGap: 24, rowGap: 8 }}>
                      {([
                        { label: "Download", color: "var(--accent-network)",    v: metrics?.network.rxBytesPerSec ?? null },
                        { label: "Upload",   color: "var(--accent-network-tx)", v: metrics?.network.txBytesPerSec ?? null },
                      ]).map(x => (
                        <div key={x.label} className="flex flex-col" style={{ gap: 2 }}>
                          <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
                            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: x.color }} />{x.label}
                          </span>
                          <span className="font-mono tabular-nums" style={{ fontSize: 20, fontWeight: 500, color: "var(--text)", lineHeight: 1.2 }}>
                            {loading ? "—" : `${fmtBytes(x.v, 1, du)}/s`}
                          </span>
                        </div>
                      ))}
                    </div>
                    <NetworkChart rx={rxHistory} tx={txHistory} times={netTimes} du={du} height={140} />
                    {!loading && (
                      <div className="flex flex-wrap justify-between text-xs tabular-nums" style={{ columnGap: 12, rowGap: 4, color: "var(--text-faint)", paddingTop: 10, borderTop: "1px solid var(--divider)" }}>
                        <span>↓ {fmtBytes(metrics?.network.rxBytesTotal ?? null, 1, du)} · ↑ {fmtBytes(metrics?.network.txBytesTotal ?? null, 1, du)} since boot</span>
                        {metrics?.sysInfo?.tcpEstab != null && (
                          <span>TCP <span className="font-mono" style={{ color: "var(--text-muted)" }}>{metrics.sysInfo.tcpEstab}</span> established</span>
                        )}
                      </div>
                    )}
                    {isExpanded("network") && rxHistory.length > 0 && (
                      <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid var(--divider)" }}>
                        <StatRow label="Peak download" value={`${fmtBytes(Math.max(...rxHistory), 1, du)}/s`} />
                        <StatRow label="Peak upload" value={`${fmtBytes(Math.max(...txHistory), 1, du)}/s`} />
                      </div>
                    )}
                  </Card>
                  </DraggableCard></div>
                )}

                {/* GPU */}
                {isVisible("gpu") && (
                  <div style={{ order: orderIndex("gpu") }}><DraggableCard cardKey="gpu" onReorder={reorderCards}>
                  <Card label="gpu" accent={gpuColor} alertLevel={gpuTempAlert} icon={<IconGPU />}
                    animDelay={200} expanded={isExpanded("gpu")} onToggle={() => toggleCard("gpu")}>
                    {loading ? <Skeleton /> : (
                      <>
                        <div className="flex items-center gap-4">
                          <div className="relative flex items-center justify-center shrink-0" style={{ width: 88, height: 88 }}>
                            <RadialGauge percent={gpuUtil ?? 0} color={gpuColor} size={88} />
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="font-medium tabular-nums font-mono" style={{ fontSize: 22, lineHeight: 1, color: "var(--text)" }}>
                                {gpuUtil != null ? gpuUtil.toFixed(0) : "—"}
                              </span>
                              <span className="text-xs" style={{ color: "var(--text-faint)" }}>%</span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 min-w-0">
                            {metrics?.gpu?.name && (
                              <span className="text-xs font-medium truncate" style={{ color: "var(--text-secondary)" }}>{metrics.gpu.name}</span>
                            )}
                            {metrics?.gpu?.temperature != null && (
                              <div className="flex items-baseline gap-2">
                                <span className="font-medium tabular-nums font-mono"
                                  style={{ fontSize: 22, lineHeight: 1, color: tempColor(metrics.gpu.temperature), transition: "color 0.3s ease" }}>
                                  {fmtTemp(metrics.gpu.temperature, tu)}
                                </span>
                                <TrendDelta history={gpuTempHistory} current={metrics.gpu.temperature} goodDirection="down" suffix="°" precision={0} threshold={1} />
                              </div>
                            )}
                            {metrics?.gpu?.powerDraw != null && (
                              <span className="text-xs tabular-nums" style={{ color: "var(--text-label)" }}>
                                {metrics.gpu.powerDraw.toFixed(1)} W
                              </span>
                            )}
                          </div>
                        </div>
                        <LabeledBar label="VRAM" right={`${fmtBytes(metrics?.gpu?.memUsed ?? null, 1, du)} / ${fmtBytes(metrics?.gpu?.memTotal ?? null, 1, du)}`}
                          percent={gpuMemPct} color="var(--accent-gpu)" />
                        {metrics?.gpu?.powerDraw != null && metrics?.gpu?.powerLimit != null && (
                          <LabeledBar label="Power" right={`${metrics.gpu.powerDraw.toFixed(1)} / ${metrics.gpu.powerLimit.toFixed(0)} W`}
                            percent={gpuPwrPct} color="var(--accent-gpu)" />
                        )}
                        {(() => {
                          const tertiaryItems: { label: string; value: string }[] = [];
                          if (metrics?.gpu?.coreClock != null) tertiaryItems.push({ label: "core", value: `${metrics.gpu.coreClock} MHz` });
                          if (metrics?.gpu?.memClock  != null) tertiaryItems.push({ label: "mem",  value: `${metrics.gpu.memClock} MHz`  });
                          if (metrics?.gpu?.fanSpeed  != null) tertiaryItems.push({ label: "fan",  value: `${metrics.gpu.fanSpeed}%`    });
                          const enc = metrics?.gpu?.encUtil ?? 0;
                          const dec = metrics?.gpu?.decUtil ?? 0;
                          if (enc > 0 || dec > 0) {
                            if (metrics?.gpu?.encUtil != null) tertiaryItems.push({ label: "enc", value: `${enc}%` });
                            if (metrics?.gpu?.decUtil != null) tertiaryItems.push({ label: "dec", value: `${dec}%` });
                          }
                          if (tertiaryItems.length === 0) return null;
                          return (
                            <div className="flex flex-wrap gap-1.5 pt-1" style={{ borderTop: "1px solid var(--border-dim)" }}>
                              {tertiaryItems.map(item => (
                                <span key={item.label} className="tabular-nums font-mono" style={{
                                  background: "var(--card)", border: "1px solid var(--border)",
                                  borderRadius: 4, padding: "2px 7px", fontSize: 12, color: "var(--text-dim)", letterSpacing: "0.01em",
                                }}>
                                  <span style={{ color: "var(--text-faint)", marginRight: 4 }}>{item.label}</span>
                                  {item.value}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                        {gpuTempHistory.length >= 2 && (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex justify-between items-center">
                              <span className="text-xs" style={{ color: "var(--text-ghost)" }}>Temperature history</span>
                            </div>
                            <Sparkline data={gpuTempHistory} color={metrics?.gpu?.temperature != null && metrics.gpu.temperature >= 70 ? tempColor(metrics.gpu.temperature) : "var(--accent-gpu)"} autoMax height={28} />
                          </div>
                        )}
                        {isExpanded("gpu") && (() => {
                          const s  = histStats(gpuHistory);
                          const ts = histStats(gpuTempHistory);
                          return (
                            <div className="flex flex-col gap-0.5 pt-2" style={{ borderTop: "1px solid var(--divider)" }}>
                              <StatRow label="Util min" value={s.min != null ? fmtPct(s.min) : "—"} />
                              <StatRow label="Util max" value={s.max != null ? fmtPct(s.max) : "—"} />
                              <StatRow label="Util avg" value={s.avg != null ? fmtPct(s.avg) : "—"} />
                              <StatRow label="Temp min" value={fmtTemp(ts.min ?? null, tu)} />
                              <StatRow label="Temp max" value={fmtTemp(ts.max ?? null, tu)} />
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </Card>
                  </DraggableCard></div>
                )}

                {/* Speedtest */}
                {isVisible("speedtest") && (
                  <div style={{ order: orderIndex("speedtest") }}><DraggableCard cardKey="speedtest" onReorder={reorderCards}>
                  <Card label="speedtest" accent="var(--accent-speedtest)" icon={<IconSpeedtest />}
                    animDelay={250} externalLink={`http://${clientConfig?.truenasIp ?? "192.168.88.196"}:${SVC_PORTS.speedtest}`}>
                    {speedtestLoading ? <Skeleton /> : !speedtestResults.length ? (
                      <div className="flex flex-col items-center justify-center text-center gap-1.5" style={{ flex: 1, minHeight: 96, padding: "8px 0" }}>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>No results from SpeedTracker yet</span>
                        <span style={{ fontSize: 12, color: "var(--text-ghost)", maxWidth: 220, lineHeight: 1.5 }}>
                          Tests run on SpeedTracker&apos;s own schedule. If this stays empty, check its URL and API token in Setup.
                        </span>
                      </div>
                    ) : (() => {
                      const latest = speedtestResults[0];
                      const ts   = latest.timestamp ?? latest.created_at;
                      const tsMs = ts ? new Date(ts).getTime() : null;
                      const diff = tsMs != null ? (Date.now() - tsMs) / 1000 : null;
                      const rel  = diff == null ? null
                        : diff < 60    ? "just now"
                        : diff < 3600  ? `${Math.round(diff / 60)}m ago`
                        : diff < 86400 ? `${Math.round(diff / 3600)}h ago`
                        : `${Math.round(diff / 86400)}d ago`;
                      // Color the timestamp by age — a result from 278 days ago
                      // should be visibly stale rather than blending into the bg.
                      const relColor = ageColor(tsMs, { warnSec: 7 * 86400, critSec: 30 * 86400 });
                      const isStale = diff != null && diff > 7 * 86400;
                      const dl = latest.download;
                      const quality = dl == null ? null
                        : dl >= 500 ? { label: "Excellent", color: "var(--text-muted)", bg: "var(--surface)", border: "var(--border)" }
                        : dl >= 200 ? { label: "Good",      color: "var(--text-muted)", bg: "var(--surface)", border: "var(--border)" }
                        : dl >= 50  ? { label: "Fair",      color: "var(--warn)", bg: "color-mix(in srgb, var(--warn) 12%, transparent)", border: "color-mix(in srgb, var(--warn) 30%, transparent)" }
                        :             { label: "Poor",      color: "var(--critical)", bg: "color-mix(in srgb, var(--critical) 12%, transparent)", border: "color-mix(in srgb, var(--critical) 30%, transparent)" };
                      return (
                        <div className="flex flex-col gap-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col gap-0.5">
                              {latest.isp && <span className="text-[12px] font-semibold" style={{ color: "var(--text-mid)" }}>{latest.isp}</span>}
                              {latest.serverLocation && <span className="text-xs" style={{ color: "var(--text-label)" }}>{latest.serverLocation}</span>}
                              {latest.serverHost && <span title={latest.serverHost} className="text-xs font-mono truncate" style={{ color: "var(--text-ghost)", maxWidth: 160 }}>{latest.serverHost}</span>}
                            </div>
                            {quality && (
                              <span className="text-xs font-semibold shrink-0 mt-0.5"
                                style={{ color: quality.color, background: quality.bg, border: `1px solid ${quality.border}`, borderRadius: 5, padding: "2px 7px" }}>
                                {quality.label}
                              </span>
                            )}
                          </div>
                          <div className="flex items-end gap-4">
                            <div className="flex flex-col">
                              <span className="font-medium tabular-nums font-mono" style={{ fontSize: 44, lineHeight: 1, color: "var(--text)" }}>
                                {dl != null ? dl.toFixed(0) : "—"}
                              </span>
                              <span className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>Mbps ↓</span>
                            </div>
                            <div className="flex flex-col mb-[4px]">
                              <span className="font-medium tabular-nums font-mono" style={{ fontSize: 28, lineHeight: 1, color: "var(--text-secondary)" }}>
                                {latest.upload != null ? latest.upload.toFixed(0) : "—"}
                              </span>
                              <span className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>Mbps ↑</span>
                            </div>
                          </div>
                          {(latest.ping != null || latest.jitter != null) && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--text-ghost)" }} />
                              {latest.ping != null && (
                                <>
                                  <span className="text-xs tabular-nums font-medium font-mono" style={{ color: "var(--text-secondary)" }}>
                                    {latest.ping < 10 ? latest.ping.toFixed(1) : latest.ping.toFixed(0)} ms
                                  </span>
                                  <span className="text-xs" style={{ color: "var(--text-ghost)" }}>ping</span>
                                </>
                              )}
                              {latest.jitter != null && (
                                <>
                                  <span style={{ color: "var(--text-ghost)", fontSize: 12 }}>·</span>
                                  <span className="text-xs tabular-nums font-medium font-mono" style={{ color: "var(--text-label)" }}>
                                    {latest.jitter < 10 ? latest.jitter.toFixed(1) : latest.jitter.toFixed(0)} ms
                                  </span>
                                  <span className="text-xs" style={{ color: "var(--text-ghost)" }}>jitter</span>
                                </>
                              )}
                            </div>
                          )}
                          {speedtestHistory.length >= 2 && (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs" style={{ color: "var(--text-ghost)" }}>Download history</span>
                              <Sparkline data={speedtestHistory} color="var(--accent-speedtest)" height={40} />
                            </div>
                          )}
                          <div className="flex items-center justify-between flex-wrap gap-1">
                            {rel && (
                              <span
                                title={tsMs ? new Date(tsMs).toLocaleString() : undefined}
                                className="text-xs tabular-nums"
                                style={{ color: relColor, fontWeight: isStale ? 600 : 400 }}>
                                Auto-tested · {rel}
                              </span>
                            )}
                            {speedtestTotalTests != null && (
                              <span className="text-xs tabular-nums" style={{ color: "var(--text-ghost)" }}>
                                {speedtestTotalTests.toLocaleString()} tests recorded
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </Card>
                  </DraggableCard></div>
                )}

                {/* System + Grafana — pinned to the end regardless of card reorder */}
                {/* System, then Grafana. With a panel configured they share a
                    full-width row; without one, System is an ordinary grid cell
                    and Grafana shrinks to a one-line hint under the grid. */}
                {(() => {
                  const grafanaSet = !!(clientConfig?.grafana.panelUrl || clientConfig?.grafana.panels?.length);
                  const system = isVisible("system") && (
                      <Card label="system" accent="var(--accent-system)" icon={<IconTerminal />}
                        expanded={isExpanded("system")} onToggle={() => toggleCard("system")}>
                        {loading ? <Skeleton /> : (
                          <div className="flex flex-col gap-0">
                            {([
                              { label: "OS",           value: metrics?.sysInfo?.os       ?? "—", mono: false },
                              { label: "Kernel",       value: metrics?.sysInfo?.kernel   ?? "—", mono: true  },
                              { label: "Architecture", value: metrics?.sysInfo?.arch     ?? "—", mono: false },
                              { label: "Host",         value: metrics?.sysInfo?.hostname ?? "—", mono: false },
                              { label: "Cores",        value: metrics?.sysInfo?.cpuCores != null ? `${metrics.sysInfo.cpuCores} cores` : "—", mono: false },
                              { label: "Up since",     value: fmtSince(metrics?.uptime ?? null), mono: true  },
                            ] as { label: string; value: string; mono: boolean }[]).map(({ label, value, mono }, i, arr) => (
                              <div key={label}>
                                <div className="flex items-center gap-2 py-2">
                                  <span className="text-xs shrink-0" style={{ color: "var(--text-faint)" }}>{label}</span>
                                  <span className={`text-xs font-medium ml-auto truncate${mono ? " font-mono" : ""}`}
                                    style={{ color: "var(--text-mid)" }}>{value}</span>
                                </div>
                                {i < arr.length - 1 && <div style={{ height: 1, background: "var(--surface-bright)" }} />}
                              </div>
                            ))}
                            {uptimeHistory.length > 1 && (
                              <div style={{ marginTop: 8 }}>
                                <UptimeTimeline history={uptimeHistory} height={20} />
                              </div>
                            )}
                          </div>
                        )}
                      </Card>
                  );
                  // Not before /api/config answers, or an unconfigured hint
                  // would flash in place of a configured panel.
                  const grafana = isVisible("grafana") && clientConfig && (
                      <ErrorBoundary name="Grafana panel">
                        <GrafanaCard
                          baseUrl={clientConfig?.grafana.baseUrl ?? `http://${clientConfig?.truenasIp ?? "localhost"}:30037`}
                          panelUrl={clientConfig?.grafana.panelUrl ?? null}
                          panels={clientConfig?.grafana.panels}
                          tokenSet={clientConfig?.grafanaTokenSet}
                        />
                      </ErrorBoundary>
                  );
                  if (grafanaSet && system && grafana) return (
                    <div className="span-all grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch" style={{ order: 9999 }}>
                      {system}{grafana}
                    </div>
                  );
                  return (
                    <>
                      {system && <div style={{ order: 9999 }}>{system}</div>}
                      {grafana && <div className="span-all" style={{ order: 10000 }}>{grafana}</div>}
                    </>
                  );
                })()}
              </div>

              {/* ── Disk health (SMART) ── */}
              {/* Draws its own card; collapses to a slim hint (or nothing) with no exporter. */}
              {isVisible("system") && (
                <ErrorBoundary name="Disk health">
                  <DiskHealthPanel />
                </ErrorBoundary>
              )}

              {/* ── Custom cards (user-defined PromQL) ── */}
              <ErrorBoundary name="Custom cards">
                <CustomCardsGrid refreshInterval={settings.refreshInterval} />
              </ErrorBoundary>

            </div>
            <div className="dash-side">
              {/* ── Now playing ── */}
              {(() => {
                const tautulliSvc = services?.find(s => s.name === "tautulli");
                const streams = tautulliSvc?.streams ?? [];
                if (!streams.length) return null;
                return (
                  <div style={{
                    background: "var(--card)", border: "1px solid var(--border)",
                    borderRadius: 10, padding: 16,
                  }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span aria-hidden="true" style={{
                        width: 7, height: 7, borderRadius: "50%", background: "var(--accent-speedtest)", flexShrink: 0,
                      }} />
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                        Now playing · {streams.length} stream{streams.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="flex flex-col gap-3">
                      {streams.map((st, i) => (
                        <div key={i} className="flex flex-col gap-1.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[12px] font-medium truncate" style={{ color: "var(--text-secondary)" }}>{st.title}</span>
                            {st.posStr && <span className="text-xs tabular-nums font-mono shrink-0" style={{ color: "var(--text-faint)" }}>{st.posStr}</span>}
                          </div>
                          <div className="flex items-center gap-1">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-faint)", flexShrink: 0 }}>
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                            </svg>
                            <span style={{ fontSize: 12, color: "var(--text-label)" }}>{st.user}</span>
                          </div>
                          <div style={{ height: 3, background: "var(--border-subtle)", borderRadius: 2 }}>
                            <div style={{
                              height: "100%", borderRadius: 2,
                              width: `${Math.min(100, st.progress)}%`,
                              background: "var(--data-strong)",
                            }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── services ── */}
              {isVisible("services") && (
                <ErrorBoundary name="Services">
                  <ServicesPanel
                    services={services}
                    servicesLoading={servicesLoading}
                    servicesUpdatedAt={servicesUpdatedAt}
                    serviceFilter={serviceFilter}
                    setServiceFilter={setServiceFilter}
                    serviceFilterRef={serviceFilterRef}
                    clientConfig={clientConfig}
                    setLogsContainer={setLogsContainer}
                    restartingSvc={restartingSvc}
                    restartService={restartService}
                  />
                </ErrorBoundary>
              )}

              {/* ── media: recent activity, then what's coming up ── */}
              {isVisible("activity") && (
                <ErrorBoundary name="Activity feed">
                  <ActivityFeed events={activityEvents} loading={activityLoading} />
                </ErrorBoundary>
              )}
              {isVisible("calendar") && (
                <ErrorBoundary name="Coming up">
                  <ComingUp timezone={settings.timezone} sonarrUrl={clientConfig?.serviceUrls?.sonarr} />
                </ErrorBoundary>
              )}
            </div>
          </div>

          {/* ── bookmarks ── */}
          {showBookmarks && (
            <BookmarksPanel
              clientConfig={clientConfig}
              setClientConfig={setClientConfig}
            />
          )}

          {/* ── footer ── */}
          <div className="flex items-center justify-between flex-wrap gap-3" style={{ borderTop: "1px solid var(--border-dim)", paddingTop: 12 }}>
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center rounded" style={{ width: 16, height: 16, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 700, color: "var(--text-label)" }}>C</span>
              <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>built with claude code</span>
            </div>
            <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>
              tracking {services?.length ?? 0} services · G search · R refresh · H bookmarks · Ctrl+K palette · ? shortcuts
            </span>
            <a href={`http://${clientConfig?.truenasIp ?? "192.168.88.196"}:${SVC_PORTS.prometheus}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12, color: "var(--text-ghost)", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text-muted)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-ghost)")}>
              prometheus ↗
            </a>
          </div>

        </div>
      </main>

      {showSettings && (
        <ErrorBoundary name="Settings">
          <SettingsPanel settings={settings} onUpdate={setSettings} onClose={() => setShowSettings(false)} services={services} />
        </ErrorBoundary>
      )}

      {showShortcuts && (
        <ErrorBoundary name="Keyboard shortcuts">
          <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
        </ErrorBoundary>
      )}

      {showNotifications && (
        <ErrorBoundary name="Notifications">
          <NotificationCenter onClose={() => setShowNotifications(false)} />
        </ErrorBoundary>
      )}

      {showCommandPalette && (
        <ErrorBoundary name="Command palette">
          <CommandPalette onClose={() => setShowCommandPalette(false)} actions={commandActions} />
        </ErrorBoundary>
      )}

      {showTopology && (
        <ErrorBoundary name="Network topology">
          <NetworkTopology onClose={() => setShowTopology(false)} />
        </ErrorBoundary>
      )}

      {showServerFleet && (
        <ErrorBoundary name="Server fleet">
          <ServerFleetPanel onClose={() => setShowServerFleet(false)} />
        </ErrorBoundary>
      )}

      {showDependencyMap && (
        <ErrorBoundary name="Dependency map">
          <DependencyMap
            onClose={() => setShowDependencyMap(false)}
            services={services?.map(s => ({ name: s.name, up: s.up, configured: s.configured !== false })) ?? []}
          />
        </ErrorBoundary>
      )}

      {logsContainer && (
        <ErrorBoundary name="Container logs">
          <ContainerLogsSheet containerName={logsContainer} onClose={() => setLogsContainer(null)} />
        </ErrorBoundary>
      )}

      {restartMsg && (
        <div className="fixed bottom-6 right-6 z-50" style={{
          background: restartMsg.ok ? "var(--ok)" : "var(--critical)",
          color: "#0a0c12", fontSize: 12, fontWeight: 600,
          padding: "8px 14px", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          <span style={{ fontFamily: "monospace", marginRight: 6 }}>{restartMsg.name}</span>
          {restartMsg.text}
        </div>
      )}
    </>
  );
}
