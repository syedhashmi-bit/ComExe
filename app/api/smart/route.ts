import { NextResponse } from "next/server";
import { promRange, promScalar, promVector } from "@/app/lib/prometheus";
import { createKeyedTTLCache, createTTLCache } from "@/app/lib/cache";
import { loadConfig } from "@/app/lib/server-config";
import type { SmartDetail, SmartDisk, SmartFeed } from "@/app/lib/types";

// Resolved per request via loadConfig() so a Prometheus URL set through the
// /setup wizard actually applies — reading process.env at module scope made
// wizard-written config invisible here.

const cache = createTTLCache<SmartFeed>(30_000);
// The 24 h temperature lines move slowly and cost two range queries, so they
// get their own longer cache.
const historyCache = createTTLCache<Map<string, number[]>>(5 * 60_000);
const detailCache = createKeyedTTLCache<SmartDetail>(5 * 60_000, 32);

// The device goes into PromQL label matchers, so only a plain device name gets
// that far: "/dev/" then letters and digits. Anything else is a 400.
const DEVICE = /^\/dev\/[a-z][a-z0-9]{1,15}$/;

// One drive, for the panel's expanded row: a week of temperatures (two-hourly)
// and every SMART attribute smartmon reports, plus firmware and serial.
async function detail(base: string, device: string): Promise<SmartDetail> {
  const hit = detailCache.get(device);
  if (hit) return hit;
  const now = Date.now(), from = now - 7 * 86_400_000, step = 7200;
  const name = device.slice(5);
  const [attrs, info, temps, nvmeTemps, nvmeInfo] = await Promise.all([
    promVector(base, `{__name__=~"smartmon_.+_raw_value",disk="${device}"}`),
    promVector(base, `smartmon_device_info{disk="${device}"}`),
    promRange(base, `smartmon_temperature_celsius_raw_value{disk="${device}"}`, from, now, step),
    promRange(base, `node_hwmon_temp_celsius{chip="nvme_${name}",sensor="temp1"}`, from, now, step),
    promVector(base, `node_nvme_info{device="${name}"}`),
  ]);
  const series = (temps[0]?.values.length ? temps[0] : nvmeTemps[0])?.values ?? [];
  const labels = info[0]?.metric ?? {};
  const nvme = nvmeInfo[0]?.metric ?? {};
  const out: SmartDetail = {
    device,
    attributes: attrs
      .map(a => ({
        id: a.metric.smart_id ? Number(a.metric.smart_id) : null,
        name: (a.metric.__name__ ?? "").replace(/^smartmon_/, "").replace(/_raw_value$/, ""),
        value: a.value,
      }))
      .filter(a => a.name && isFinite(a.value))
      .sort((a, b) => (a.id ?? 999) - (b.id ?? 999) || a.name.localeCompare(b.name)),
    firmware: labels.firmware_version || nvme.firmware_revision || null,
    serial: labels.serial_number || nvme.serial || null,
    history: series.map(p => ({ ts: p.ts, value: Math.round(p.value * 10) / 10 })),
  };
  detailCache.set(device, out);
  return out;
}

const NVME_TEMP = `node_hwmon_temp_celsius{chip=~"nvme_.+",sensor="temp1"}`;
// node_exporter names an NVMe drive's sensor chip "nvme_nvme0"; smartmon calls it "/dev/nvme0".
const nvmeDev = (chip?: string) => (chip ? `/dev/${chip.replace(/^nvme_/, "")}` : "");

// smartmon's `type` label → the interface shown in the panel.
function driveKind(type?: string): SmartDisk["kind"] {
  if (!type) return null;
  if (type.startsWith("nvme")) return "nvme";
  if (type.startsWith("sat")) return "sata";
  if (type === "scsi" || type.startsWith("megaraid")) return "sas";
  return null;
}

// Half-hourly temperatures over the last day, per drive, oldest first.
async function tempHistory(base: string): Promise<Map<string, number[]>> {
  const hit = historyCache.get();
  if (hit) return hit;
  const now = Date.now(), from = now - 24 * 3_600_000, step = 1800;
  const [smart, nvme] = await Promise.all([
    promRange(base, "smartmon_temperature_celsius_raw_value", from, now, step),
    promRange(base, NVME_TEMP, from, now, step),
  ]);
  const out = new Map<string, number[]>();
  for (const s of smart) if (s.metric.disk) out.set(s.metric.disk, s.values.map(v => v.value));
  for (const s of nvme) {
    const dev = nvmeDev(s.metric.chip);
    if (dev && !out.has(dev)) out.set(dev, s.values.map(v => Math.round(v.value * 10) / 10));
  }
  historyCache.set(out);
  return out;
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

export async function GET(req?: Request) {
  const device = req ? new URL(req.url).searchParams.get("device") : null;
  if (device != null) {
    if (!DEVICE.test(device)) return NextResponse.json({ ok: false, message: "bad device" }, { status: 400 });
    const cfg = await loadConfig();
    try {
      return NextResponse.json(await detail(cfg.prometheusUrl, device));
    } catch (e) {
      return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
    }
  }

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
    //
    // NVMe drives: smartmon.sh reports only their health and serial — no
    // attributes, and an empty device_model. node_exporter's own collectors
    // fill in what they can: the kernel's composite temperature sensor
    // (hwmon chip "nvme_nvme0", sensor temp1) and the model (node_nvme_info).
    const [tempResults, powerOnResults, reallocResults, pendingResults, uncorrResults, healthResults, infoResults, nvmeTempResults, nvmeInfoResults, lastRun, history] = await Promise.all([
      queryAll("smartmon_temperature_celsius_raw_value"),
      queryAll("smartmon_power_on_hours_raw_value"),
      queryAll("smartmon_reallocated_sector_ct_raw_value"),
      queryAll("smartmon_current_pending_sector_raw_value"),
      queryAll("smartmon_offline_uncorrectable_raw_value"),
      queryAll("smartmon_device_smart_healthy"),
      queryAll("smartmon_device_info"),
      queryAll(NVME_TEMP),
      queryAll("node_nvme_info"),
      // When the SMART script last ran — the panel says so, and flags it when
      // the cron job has stopped.
      promScalar(cfg.prometheusUrl, "max(smartmon_smartctl_run)"),
      tempHistory(cfg.prometheusUrl),
    ]);

    const temps = buildDiskMap(tempResults);
    const powerOn = buildDiskMap(powerOnResults);
    const realloc = buildDiskMap(reallocResults);
    const pending = buildDiskMap(pendingResults);
    const uncorr = buildDiskMap(uncorrResults);
    const healthMap = buildDiskMap(healthResults);

    const kindMap = new Map<string, SmartDisk["kind"]>();
    for (const r of [...healthResults, ...infoResults]) {
      const dev = r.metric.disk ?? "";
      if (dev && !kindMap.has(dev)) kindMap.set(dev, driveKind(r.metric.type));
    }

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

    // The drives smartmon reports. node_exporter's NVMe metrics below only fill
    // gaps for these; on their own they don't mean disk health is set up.
    const allDevices = new Set([...temps.keys(), ...powerOn.keys(), ...realloc.keys(), ...healthMap.keys()]);

    // Keyed like smartmon's disk label: chip "nvme_nvme0" / device "nvme0" → "/dev/nvme0".
    for (const r of nvmeTempResults) {
      const dev = nvmeDev(r.metric.chip);
      if (dev && !temps.has(dev) && isFinite(r.value)) temps.set(dev, Math.round(r.value));
    }
    for (const r of nvmeInfoResults) {
      const dev = r.metric.device ? `/dev/${r.metric.device}` : "";
      if (dev && !modelMap.has(dev) && r.metric.model) modelMap.set(dev, r.metric.model.trim());
      if (dev && !serialMap.has(dev) && r.metric.serial) serialMap.set(dev, r.metric.serial.trim());
    }

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
        kind: kindMap.get(dev) ?? (dev.startsWith("/dev/nvme") ? "nvme" : null),
        model: modelMap.get(dev) ?? "Unknown",
        serial: serialMap.get(dev) ?? "",
        temperature: temps.get(dev) ?? null,
        powerOnHours: powerOn.get(dev) ?? null,
        reallocatedSectors: reallocVal,
        pendingSectors: pendingVal,
        uncorrectableSectors: uncorrVal,
        healthy,
        history: history.get(dev) ?? [],
      };
    }).sort((a, b) => a.device.localeCompare(b.device));

    const response: SmartFeed = {
      disks,
      readAt: lastRun != null && isFinite(lastRun) ? lastRun * 1000 : null,
      timestamp: Date.now(),
    };
    cache.set(response);
    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json({ disks: [], error: (e as Error).message }, { status: 500 });
  }
}
