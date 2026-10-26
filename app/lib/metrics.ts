// ── Host metrics from Prometheus ────────────────────────────────────────────
// The logic behind /api/metrics, extracted so the background collector
// (lib/collector.ts) can call it in-process. Shares one TTL cache with the
// route via globalSingleton, and appends a history point on every real fetch.
//
// IMPORTANT: server-only. Never import from "use client" modules.

import { appendHistory } from "@/app/lib/history";
import { promScalar, promVector, resolveNamed } from "@/app/lib/prometheus";
import { createTTLCache } from "@/app/lib/cache";
import { loadConfig, type ResolvedConfig } from "@/app/lib/server-config";
import { globalSingleton } from "@/app/lib/singleton";

// 9s — matches the 10s SSE cycle. ~30 PromQL queries per refresh means even
// Prometheus benefits from the caching when multiple browser tabs, plus the
// collector, are asking.
const state = globalSingleton("metrics", () => ({
  cache: createTTLCache<MetricsPayload>(9_000),
  inflight: null as Promise<MetricsPayload> | null,
  // Last payload regardless of age, for the collector's no-upstream-work peek.
  last: null as MetricsPayload | null,
}));

const FS_EXCLUDE = `fstype!~"tmpfs|devtmpfs|overlay|squashfs|ramfs"`;

export type MetricsPayload = Awaited<ReturnType<typeof fetchMetrics>>;

export async function getMetrics(): Promise<MetricsPayload> {
  const cached = state.cache.get();
  if (cached) return cached;
  // Dedupe concurrent misses — the collector tick and an SSE self-fetch can
  // arrive together, and each miss is ~30 Prometheus queries plus a history
  // append.
  if (!state.inflight) {
    state.inflight = loadConfig()
      .then(fetchMetrics)
      .finally(() => { state.inflight = null; });
  }
  return state.inflight;
}

// Whatever was fetched last, however old, with no upstream work at all.
export function peekMetrics(): MetricsPayload | null {
  return state.last;
}

async function fetchMetrics(cfg: ResolvedConfig) {
  const query    = (q: string) => promScalar(cfg.prometheusUrl, q);
  const queryAll = (q: string) => promVector(cfg.prometheusUrl, q);
  // Per-deployment paths and filters, resolved per request so they follow the
  // same config layering as everything else. They used to be read from
  // process.env at module scope — the bug class CLAUDE.md warns about.
  const { fsPathPrefix, poolPath, netExclude } = cfg;

  const r = await resolveNamed({
    cpuIdle:          query(`avg(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100`),
    memTotal:         query(`node_memory_MemTotal_bytes`),
    memAvailable:     query(`node_memory_MemAvailable_bytes`),
    memSReclaimable:  query(`node_memory_SReclaimable_bytes`),
    uptime:           query(`time() - node_boot_time_seconds`),
    diskSizeResults:  queryAll(`node_filesystem_size_bytes{${FS_EXCLUDE}}`),
    diskAvailResults: queryAll(`node_filesystem_avail_bytes{${FS_EXCLUDE}}`),
    netRxResults:     queryAll(`rate(node_network_receive_bytes_total{device!~"${netExclude}"}[2m])`),
    netTxResults:     queryAll(`rate(node_network_transmit_bytes_total{device!~"${netExclude}"}[2m])`),
    gpuUtilRatio:     query(`nvidia_smi_utilization_gpu_ratio`),
    gpuMemUsed:       query(`nvidia_smi_memory_used_bytes`),
    gpuMemTotal:      query(`nvidia_smi_memory_total_bytes`),
    gpuTemp:          query(`nvidia_smi_temperature_gpu`),
    gpuPower:         query(`nvidia_smi_power_draw_watts`),
    gpuPowerLimit:    query(`nvidia_smi_power_limit_watts`),
    gpuInfoResults:   queryAll(`nvidia_smi_gpu_info`),
    netRxTotal:       query(`sum(node_network_receive_bytes_total{device!~"${netExclude}"})`),
    netTxTotal:       query(`sum(node_network_transmit_bytes_total{device!~"${netExclude}"})`),
    unameResults:     queryAll(`node_uname_info`),
    cpuCoreCount:     query(`count(node_cpu_seconds_total{mode="idle"})`),
    load1:            query(`node_load1`),
    load5:            query(`node_load5`),
    load15:           query(`node_load15`),
    cpuFreqAvg:       query(`avg(node_cpu_scaling_frequency_hertz)`),
    tcpEstab:         query(`node_netstat_Tcp_CurrEstab`),
    gpuCoreClock:     query(`nvidia_smi_clocks_current_graphics_clock_hz`),
    gpuMemClock:      query(`nvidia_smi_clocks_current_memory_clock_hz`),
    gpuFanRatio:      query(`nvidia_smi_fan_speed_ratio`),
    gpuEncRatio:      query(`nvidia_smi_utilization_encoder_ratio`),
    gpuDecRatio:      query(`nvidia_smi_utilization_decoder_ratio`),
    cpuInfoResults:   queryAll(`node_cpu_info{cpu="0"}`),
    // Scrape-target health. Prometheus can be perfectly healthy while its
    // exporters are down, which empties every card with no explanation — the
    // dashboard monitored everything except its own data pipeline.
    scrapeTargetResults: queryAll(`up`),
  });

  const scrapeTargets = r.scrapeTargetResults.map(t => ({
    job:      t.metric?.job ?? "unknown",
    instance: t.metric?.instance ?? "unknown",
    up:       t.value === 1,
  }));
  const targetsDown = scrapeTargets.filter(t => !t.up);

  const cpuUsed = r.cpuIdle != null ? 100 - r.cpuIdle : null;
  const memUsed = r.memTotal != null && r.memAvailable != null ? r.memTotal - r.memAvailable : null;
  const gpuUtil = r.gpuUtilRatio != null ? r.gpuUtilRatio * 100 : null;
  const gpuName = r.gpuInfoResults[0]?.metric?.modelName ?? r.gpuInfoResults[0]?.metric?.name ?? null;

  const uname = r.unameResults[0]?.metric ?? {};
  const cpuModelRaw = r.cpuInfoResults[0]?.metric?.model_name ?? null;

  const sysInfo = {
    os:         uname.pretty_name ?? uname.sysname ?? null,
    kernel:     uname.release     ?? null,
    arch:       uname.machine     ?? null,
    hostname:   uname.nodename    ?? null,
    cpuCores:   r.cpuCoreCount != null ? Math.round(r.cpuCoreCount) : null,
    cpuModel:   cpuModelRaw,
    cpuFreqGhz: toGhz(r.cpuFreqAvg),
    load1:      r.load1  ?? null,
    load5:      r.load5  ?? null,
    load15:     r.load15 ?? null,
    tcpEstab:   r.tcpEstab != null ? Math.round(r.tcpEstab) : null,
  };

  const availMap = new Map(r.diskAvailResults.map((d) => [d.metric.mountpoint, d.value]));
  const disks = r.diskSizeResults
    .filter((d) => d.metric.mountpoint != null && d.metric.mountpoint.startsWith(fsPathPrefix))
    .map((d) => {
      const total = d.value;
      const avail = availMap.get(d.metric.mountpoint) ?? 0;
      const used  = total - avail;
      return {
        mountpoint: d.metric.mountpoint,
        device:  d.metric.device  ?? "",
        fstype:  d.metric.fstype  ?? "",
        total, avail, used,
        usedPct: total > 0 ? Math.min(100, (used / total) * 100) : 0,
      };
    })
    .sort((a, b) => a.mountpoint.localeCompare(b.mountpoint));

  // Aggregate true pool usage. On ZFS every dataset is its own mount and
  // reports the pool's shared free space as its "available", so the root
  // /mnt/Pool dataset on its own holds almost nothing (the data lives in child
  // datasets). Computing size − avail for just the root therefore yields a
  // near-zero, misleading number (e.g. "262 KB of 4.4 TB, 0%"). Instead sum
  // the real used bytes across every dataset under the pool — each dataset is
  // a separate mount so there's no double-counting — and derive the total from
  // used + the pool's shared available space.
  const poolMounts = r.diskSizeResults.filter(
    d => d.metric.mountpoint != null &&
         (d.metric.mountpoint === poolPath || d.metric.mountpoint.startsWith(poolPath + "/")),
  );
  const poolAvail = poolMounts.length > 0
    ? (availMap.get(poolPath) ?? availMap.get(poolMounts[0].metric.mountpoint) ?? 0)
    : null;
  const poolUsed = poolMounts.length > 0
    ? poolMounts.reduce((s, d) => s + Math.max(0, d.value - (availMap.get(d.metric.mountpoint) ?? 0)), 0)
    : null;
  const poolSize = poolUsed != null && poolAvail != null ? poolUsed + poolAvail : null;

  const netRx = r.netRxResults.reduce((s, n) => s + (isNaN(n.value) ? 0 : n.value), 0);
  const netTx = r.netTxResults.reduce((s, n) => s + (isNaN(n.value) ? 0 : n.value), 0);
  const primaryIface = r.netRxResults.length > 0
    ? (r.netRxResults.reduce((a, b) => (a.value > b.value ? a : b)).metric.device ?? null)
    : null;

  const responseData = {
    cpu: cpuUsed,
    memory: { total: r.memTotal, used: memUsed, available: r.memAvailable, sReclaimable: r.memSReclaimable },
    uptime: r.uptime,
    disks,
    pool: { total: poolSize, used: poolUsed, avail: poolAvail },
    network: {
      rxBytesPerSec: netRx, txBytesPerSec: netTx,
      rxBytesTotal: r.netRxTotal, txBytesTotal: r.netTxTotal,
      interfaceName: primaryIface,
    },
    gpu: {
      name:        gpuName,
      utilization: gpuUtil,
      memUsed:     r.gpuMemUsed,
      memTotal:    r.gpuMemTotal,
      temperature: r.gpuTemp,
      powerDraw:   r.gpuPower,
      powerLimit:  r.gpuPowerLimit,
      coreClock:   toMhz(r.gpuCoreClock),
      memClock:    toMhz(r.gpuMemClock),
      fanSpeed:    r.gpuFanRatio != null ? Math.round(r.gpuFanRatio * 100) : null,
      encUtil:     r.gpuEncRatio != null ? Math.round(r.gpuEncRatio * 100) : null,
      decUtil:     r.gpuDecRatio != null ? Math.round(r.gpuDecRatio * 100) : null,
    },
    sysInfo,
    scrapeTargets,
    // Prometheus answered but some exporters aren't reporting — the specific
    // state that makes every card render "—" for no visible reason.
    scrapeDegraded: scrapeTargets.length > 0 && targetsDown.length > 0,
    timestamp: Date.now(),
  };
  state.cache.set(responseData);
  state.last = responseData;

  // Persist a slim data point for historical charting (fire-and-forget)
  const worstDisk = disks.length > 0 ? Math.max(...disks.map(d => d.usedPct)) : null;
  appendHistory({
    ts:       responseData.timestamp,
    cpu:      cpuUsed != null ? Math.round(cpuUsed * 10) / 10 : null,
    mem:      r.memTotal && memUsed ? Math.round((memUsed / r.memTotal) * 1000) / 10 : null,
    net_rx:   Math.round(netRx),
    net_tx:   Math.round(netTx),
    gpu:      gpuUtil != null ? Math.round(gpuUtil * 10) / 10 : null,
    disk_pct: worstDisk != null ? Math.round(worstDisk * 10) / 10 : null,
  }).catch(() => {});

  return responseData;
}

// CPU frequency: metric may be Hz or already MHz — normalise to GHz
export function toGhz(v: number | null): number | null {
  if (v == null) return null;
  if (v > 1e8) return parseFloat((v / 1e9).toFixed(2));        // Hz
  if (v > 1e5) return parseFloat((v / 1e6).toFixed(2));        // kHz
  if (v > 100) return parseFloat((v / 1000).toFixed(2));       // MHz
  return parseFloat(v.toFixed(2));                             // GHz
}

// GPU clock: metric may be Hz or MHz — normalise to MHz for display
export function toMhz(v: number | null): number | null {
  if (v == null) return null;
  if (v > 1e8) return Math.round(v / 1e6);   // Hz → MHz
  if (v > 10)  return Math.round(v);         // already MHz
  return null;
}
