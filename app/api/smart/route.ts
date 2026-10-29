import { NextResponse } from "next/server";
import { promVector } from "@/app/lib/prometheus";
import { createTTLCache } from "@/app/lib/cache";
import { loadConfig } from "@/app/lib/server-config";

// Resolved per request via loadConfig() so a Prometheus URL set through the
// /setup wizard actually applies — reading process.env at module scope made
// wizard-written config invisible here.

const cache = createTTLCache<unknown>(30_000);

interface SmartDisk {
  device: string;
  model: string;
  serial: string;
  temperature: number | null;
  powerOnHours: number | null;
  reallocatedSectors: number | null;
  pendingSectors: number | null;
  uncorrectableSectors: number | null;
  healthy: boolean;
}

const makeQueryAll = (base: string) => (q: string) => promVector(base, q);

function buildDiskMap(results: { metric: Record<string, string>; value: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of results) {
    const dev = r.metric.disk ?? r.metric.device ?? r.metric.name ?? "";
    if (dev) map.set(dev, r.value);
  }
  return map;
}

export async function GET() {
  const cached = cache.get();
  if (cached) return NextResponse.json(cached);

  const cfg = await loadConfig();
  const queryAll = makeQueryAll(cfg.prometheusUrl);

  try {
    // smartmon (the prometheus-community textfile collector) exports each SMART
    // attribute twice: `_value` is the drive's normalised 0–253 health score,
    // `_raw_value` is the actual reading. This used to query `_value`, so a
    // disk "at 100°C" with "200 reallocated sectors" was a perfectly healthy
    // drive's normalised score — and the fallback health check then flagged
    // every disk. Device model and serial live as LABELS on one
    // smartmon_device_info series (device_model / serial_number); filtering
    // it on smart_id, which that series never has, matched nothing.
    const [tempResults, powerOnResults, reallocResults, pendingResults, uncorrResults, healthResults, infoResults] = await Promise.all([
      queryAll("smartmon_temperature_celsius_raw_value"),
      queryAll("smartmon_power_on_hours_raw_value"),
      queryAll("smartmon_reallocated_sector_ct_raw_value"),
      queryAll("smartmon_current_pending_sector_raw_value"),
      queryAll("smartmon_offline_uncorrectable_raw_value"),
      queryAll("smartmon_device_smart_healthy"),
      queryAll("smartmon_device_info"),
    ]);

    const temps = buildDiskMap(tempResults);
    const powerOn = buildDiskMap(powerOnResults);
    const realloc = buildDiskMap(reallocResults);
    const pending = buildDiskMap(pendingResults);
    const uncorr = buildDiskMap(uncorrResults);
    const healthMap = buildDiskMap(healthResults);

    const modelMap = new Map<string, string>();
    const serialMap = new Map<string, string>();
    for (const r of infoResults) {
      const dev = r.metric.disk ?? r.metric.device ?? r.metric.name ?? "";
      if (!dev) continue;
      const model = r.metric.device_model || r.metric.model_name || r.metric.model || r.metric.product;
      if (model) modelMap.set(dev, model);
      const serial = r.metric.serial_number || r.metric.serial;
      if (serial) serialMap.set(dev, serial);
    }

    const allDevices = new Set([...temps.keys(), ...powerOn.keys(), ...realloc.keys(), ...healthMap.keys()]);

    const disks: SmartDisk[] = Array.from(allDevices).map(dev => {
      const reallocVal = realloc.get(dev) ?? null;
      const pendingVal = pending.get(dev) ?? null;
      const uncorrVal = uncorr.get(dev) ?? null;
      const h = healthMap.get(dev);
      const healthy = h != null ? h === 1 : (
        (reallocVal === null || reallocVal === 0) &&
        (pendingVal === null || pendingVal === 0) &&
        (uncorrVal === null || uncorrVal === 0)
      );

      return {
        device: dev,
        model: modelMap.get(dev) ?? "Unknown",
        serial: serialMap.get(dev) ?? "",
        temperature: temps.get(dev) ?? null,
        powerOnHours: powerOn.get(dev) ?? null,
        reallocatedSectors: reallocVal,
        pendingSectors: pendingVal,
        uncorrectableSectors: uncorrVal,
        healthy,
      };
    }).sort((a, b) => a.device.localeCompare(b.device));

    const response = { disks, timestamp: Date.now() };
    cache.set(response);
    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json({ disks: [], error: (e as Error).message }, { status: 500 });
  }
}
