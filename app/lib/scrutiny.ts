// ── Scrutiny: SMART verdicts per drive ──────────────────────────────────────
// Scrutiny reads each drive's SMART data and judges it twice: by the drive's
// own SMART thresholds, and against Backblaze's failure rates for those
// attributes, which can flag a drive that's going bad while SMART still says
// OK. Its one summary call, GET /api/summary, needs no auth. The services row
// and the Disk health panel both read it through drivesFromSummary. Pure, no
// I/O.

import type { ScrutinyStatus } from "@/app/lib/types";

export interface ScrutinyDrive {
  device:      string;          // "/dev/sda", keyed like smartmon's disk label
  model:       string;
  status:      ScrutinyStatus;
  url:         string;          // the drive's page in Scrutiny
  collectedAt: number | null;   // ms: when Scrutiny's collector last read it
}

export interface ScrutinySummary {
  data?: { summary?: Record<string, {
    device?: { wwn?: string; device_name?: string; model_name?: string; device_status?: number; archived?: boolean };
    smart?:  { collector_date?: string };
  }> };
}

// device_status is a bit flag: 1 failed SMART, 2 failed Scrutiny's check.
function statusOf(flags: number): ScrutinyStatus {
  const smart = (flags & 1) !== 0, scrutiny = (flags & 2) !== 0;
  return smart && scrutiny ? "failed-both" : smart ? "failed-smart" : scrutiny ? "failed-scrutiny" : "passed";
}

export function drivesFromSummary(json: ScrutinySummary | null, baseUrl: string): ScrutinyDrive[] {
  const base = baseUrl.replace(/\/+$/, "");
  return Object.values(json?.data?.summary ?? {}).flatMap(({ device, smart }) => {
    if (!device?.wwn || !device.device_name || device.archived) return [];
    const at = smart?.collector_date ? Date.parse(smart.collector_date) : NaN;
    return [{
      device:      `/dev/${device.device_name.replace(/^\/dev\//, "")}`,
      model:       device.model_name ?? "",
      status:      statusOf(device.device_status ?? 0),
      url:         `${base}/web/device/${encodeURIComponent(device.wwn)}`,
      collectedAt: isNaN(at) ? null : at,
    }];
  }).sort((a, b) => a.device.localeCompare(b.device));
}

export const SCRUTINY_STATUS_TEXT: Record<ScrutinyStatus, string> = {
  "passed":          "passed",
  "failed-smart":    "failed SMART",
  "failed-scrutiny": "failed Scrutiny's check",
  "failed-both":     "failed SMART and Scrutiny's check",
};
