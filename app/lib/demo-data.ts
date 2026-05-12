// ── Demo mode data ───────────────────────────────────────────────────────────
// Realistic fake data for ?demo=1 mode. No React, no hooks — pure builders.

import type { Metrics, ServiceResult } from "@/app/lib/types";

export function buildDemoMetrics(): Metrics {
  return {
    cpu: 42.3,
    memory: { total: 68719476736, used: null, available: 27917287424, sReclaimable: 4294967296 },
    disks: [
      { mountpoint: "/mnt/Pool/Media/Movies", device: "/dev/sda1", fstype: "zfs", total: 8e12, avail: 2.8e12, used: 5.2e12, usedPct: 65 },
      { mountpoint: "/mnt/Pool/Media/TV",     device: "/dev/sdb1", fstype: "zfs", total: 8e12, avail: 4.2e12, used: 3.8e12, usedPct: 47.5 },
      { mountpoint: "/mnt/Pool/Media/Music",  device: "/dev/sdc1", fstype: "zfs", total: 2e12, avail: 1.4e12, used: 0.6e12, usedPct: 30 },
    ],
    pool: { total: 18e12, used: 9.6e12, avail: 8.4e12 },
    network: { rxBytesPerSec: 24500000, txBytesPerSec: 3200000, rxBytesTotal: 14e12, txBytesTotal: 2.1e12, interfaceName: "enp4s0" },
    gpu: {
      name: "NVIDIA GeForce RTX 3060", utilization: 28, memUsed: 3.2e9, memTotal: 12e9,
      temperature: 52, powerDraw: 85, powerLimit: 170, fanSpeed: 42, coreClock: 1807, memClock: 7501,
      encUtil: 0, decUtil: 15,
    },
    uptime: 1728000,
    sysInfo: {
      os: "TrueNAS-SCALE-24.10.2", kernel: "6.6.44-production+truenas", arch: "x86_64", hostname: "truenas",
      cpuCores: 12, cpuModel: "AMD Ryzen 5 5600X", cpuFreqGhz: 3.7,
      load1: 1.2, load5: 0.8, load15: 0.6, tcpEstab: 142,
    },
    timestamp: Date.now(),
  };
}

export function buildDemoServices(): ServiceResult[] {
  return [
    { name: "radarr",      up: true, configured: true, lines: ["1,247 movies (8.2 TB)", "12 missing cutoff", "2 in queue"], pct: 94, queueItems: [{ title: "Dune: Part Three", pct: 67, etaSec: 1200 }] },
    { name: "sonarr",      up: true, configured: true, lines: ["186 series (4.1 TB)", "3 missing episodes"], pct: 98, queueItems: [{ title: "The Bear S04E08", pct: 23, etaSec: 3600 }] },
    { name: "bazarr",      up: true, configured: true, lines: ["1,198 synced", "8 wanted"] },
    { name: "tautulli",    up: true, configured: true, lines: ["1 stream active", "47 plays this week"], streams: [{ title: "Shogun S02E04", progress: 0.45, user: "nauman", posStr: "21:30 / 47:15" }], weekly: { plays: 47, topShow: "Shogun", topUser: "nauman" } },
    { name: "qbittorrent", up: true, configured: true, lines: ["2.4 ratio overall", "↓ 12.3 MB/s · ↑ 4.1 MB/s"], pct: 78, queueItems: [{ title: "ubuntu-24.04.iso", pct: 78, etaSec: 900 }, { title: "archlinux-2024.iso", pct: 34, etaSec: 2400 }] },
    { name: "overseerr",   up: true, configured: true, lines: ["12 pending requests", "3 processing"] },
    { name: "prowlarr",    up: true, configured: true, lines: ["8 indexers active", "23,411 grabs total"] },
    { name: "pihole",      up: true, configured: true, lines: ["16,173 queries today", "22% blocked", "Top: ads.tracker.com"], pct: 22 },
    { name: "nginx",       up: true, configured: true, lines: ["14 proxy hosts", "SSL certs: 14 valid"] },
    { name: "uptimekuma",  up: true, configured: true, lines: ["24 monitors", "All up"], downCount: 0 },
  ] as ServiceResult[];
}
