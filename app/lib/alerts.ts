// ── Alert-level computation ──────────────────────────────────────────────────
// Pure functions that derive warning / critical thresholds from metrics.

import type { AlertLevel, HealthResult, Metrics } from "@/app/lib/types";

export function cpuAlertLevel(cpu: number | null): AlertLevel {
  if (cpu == null) return null;
  if (cpu > 95) return "critical";
  if (cpu > 80) return "warning";
  return null;
}

export function memAlertLevel(total: number | null, available: number | null, sReclaimable: number | null): AlertLevel {
  if (total === null || available === null || total === 0) return null;
  const realUsed = total - available - (sReclaimable ?? 0);
  const realPct  = (Math.max(0, realUsed) / total) * 100;
  if (realPct > 97) return "critical";
  if (realPct > 93) return "warning";
  return null;
}

export function diskAlertLevel(usedPct: number): AlertLevel {
  if (usedPct > 95) return "critical";
  if (usedPct > 85) return "warning";
  return null;
}

export function gpuTempAlertLevel(temp: number | null): AlertLevel {
  if (temp == null) return null;
  if (temp > 90) return "critical";
  if (temp > 80) return "warning";
  return null;
}

export function worstAlert(levels: AlertLevel[]): AlertLevel {
  if (levels.includes("critical")) return "critical";
  if (levels.includes("warning"))  return "warning";
  return null;
}

// One entry per threshold crossed. `label`/`value` are for the dashboard's
// status summary ("Memory", "94% in use"); `msg` is the compact form
// computeHealth has always joined into its reason string.
export interface HealthIssue { level: "warning" | "critical"; label: string; value: string; msg: string }

export function healthIssues(m: Metrics | null): HealthIssue[] {
  if (!m) return [];
  const issues: HealthIssue[] = [];
  if (m.cpu != null) {
    const l = cpuAlertLevel(m.cpu);
    if (l) issues.push({ level: l, label: "CPU", value: `${m.cpu.toFixed(0)}%`, msg: `cpu ${m.cpu.toFixed(0)}%` });
  }
  {
    const l = memAlertLevel(m.memory.total, m.memory.available, m.memory.sReclaimable);
    if (l && m.memory.total && m.memory.available) {
      const rp = (Math.max(0, m.memory.total - m.memory.available - (m.memory.sReclaimable ?? 0)) / m.memory.total) * 100;
      issues.push({ level: l, label: "Memory", value: `${rp.toFixed(0)}% in use`, msg: `ram ${rp.toFixed(0)}%` });
    }
  }
  if (m.gpu.temperature != null) {
    const l = gpuTempAlertLevel(m.gpu.temperature);
    if (l) issues.push({ level: l, label: "GPU temperature", value: `${m.gpu.temperature.toFixed(0)}°C`, msg: `gpu ${m.gpu.temperature.toFixed(0)}°C` });
  }
  for (const d of m.disks) {
    const l = diskAlertLevel(d.usedPct);
    if (l) issues.push({ level: l, label: d.mountpoint, value: `${d.usedPct.toFixed(0)}% full`, msg: `disk ${d.mountpoint} ${d.usedPct.toFixed(0)}%` });
  }
  return issues;
}

export function computeHealth(m: Metrics | null): HealthResult {
  if (!m) return { status: "healthy", reason: "" };
  const issues = healthIssues(m);
  const crits = issues.filter(i => i.level === "critical");
  const warns = issues.filter(i => i.level === "warning");
  if (crits.length) return { status: "critical", reason: crits.map(i => i.msg).join("  ·  ") };
  if (warns.length) return { status: "warning",  reason: warns.map(i => i.msg).join("  ·  ") };
  return { status: "healthy", reason: "" };
}
