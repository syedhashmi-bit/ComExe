import { NextResponse } from "next/server";
import { readHistory, type HistoryPoint } from "@/app/lib/history";

export const dynamic = "force-dynamic";

const METRICS: (keyof Omit<HistoryPoint, "ts">)[] = ["cpu", "mem", "net_rx", "net_tx", "gpu", "disk_pct"];

interface Anomaly {
  metric: string;
  ts: number;
  value: number;
  mean: number;
  stddev: number;
  zScore: number;
}

interface Prediction {
  metric: string;
  currentValue: number;
  trend: "rising" | "falling" | "stable";
  ratePerDay: number;
  daysUntilFull: number | null;
  warning: string | null;
}

interface SlaStats {
  uptimePct: number;
  totalPoints: number;
  downPoints: number;
  incidents: { start: number; end: number; durationMs: number }[];
  mttrMs: number | null;
  longestOutageMs: number | null;
}

function computeStats(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

function detectAnomalies(points: HistoryPoint[], metric: keyof Omit<HistoryPoint, "ts">, zThreshold = 3): Anomaly[] {
  const values = points.map(p => p[metric]).filter((v): v is number => v != null);
  if (values.length < 10) return [];
  const { mean, stddev } = computeStats(values);
  if (stddev === 0) return [];

  const anomalies: Anomaly[] = [];
  for (const p of points) {
    const v = p[metric];
    if (v == null) continue;
    const zScore = Math.abs((v - mean) / stddev);
    if (zScore >= zThreshold) {
      anomalies.push({ metric, ts: p.ts, value: v, mean, stddev, zScore });
    }
  }
  return anomalies;
}

function predictTrend(points: HistoryPoint[], metric: keyof Omit<HistoryPoint, "ts">): Prediction | null {
  const data = points
    .filter(p => p[metric] != null)
    .map(p => ({ ts: p.ts, value: p[metric] as number }));

  if (data.length < 5) return null;

  const current = data[data.length - 1].value;

  // Linear regression via least squares
  const n = data.length;
  const xMean = data.reduce((s, d) => s + d.ts, 0) / n;
  const yMean = data.reduce((s, d) => s + d.value, 0) / n;
  let num = 0, den = 0;
  for (const d of data) {
    num += (d.ts - xMean) * (d.value - yMean);
    den += (d.ts - xMean) ** 2;
  }
  const slope = den !== 0 ? num / den : 0; // value per ms
  const slopePerDay = slope * 86400000;

  const trend: Prediction["trend"] =
    Math.abs(slopePerDay) < 0.5 ? "stable" :
    slopePerDay > 0 ? "rising" : "falling";

  // For percentage metrics, predict days until 100%
  let daysUntilFull: number | null = null;
  let warning: string | null = null;
  const isPctMetric = ["cpu", "mem", "gpu", "disk_pct"].includes(metric);

  if (isPctMetric && slope > 0 && current < 100) {
    const remaining = 100 - current;
    const msUntilFull = remaining / slope;
    daysUntilFull = msUntilFull / 86400000;

    if (metric === "disk_pct" && daysUntilFull < 30) {
      warning = `Pool will be full in ~${Math.round(daysUntilFull)} days at current rate`;
    } else if (metric === "mem" && daysUntilFull < 7) {
      warning = `Memory exhaustion predicted in ~${Math.round(daysUntilFull)} days`;
    }
  }

  return {
    metric,
    currentValue: current,
    trend,
    ratePerDay: Math.round(slopePerDay * 100) / 100,
    daysUntilFull: daysUntilFull ? Math.round(daysUntilFull * 10) / 10 : null,
    warning,
  };
}

function computeSla(points: HistoryPoint[]): SlaStats {
  if (points.length === 0) {
    return { uptimePct: 100, totalPoints: 0, downPoints: 0, incidents: [], mttrMs: null, longestOutageMs: null };
  }

  // A point is "down" if cpu is null (no data = unreachable)
  let downPoints = 0;
  const incidents: { start: number; end: number; durationMs: number }[] = [];
  let incidentStart: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const isDown = points[i].cpu == null;
    if (isDown) {
      downPoints++;
      if (incidentStart == null) incidentStart = points[i].ts;
    } else {
      if (incidentStart != null) {
        const end = points[i].ts;
        incidents.push({ start: incidentStart, end, durationMs: end - incidentStart });
        incidentStart = null;
      }
    }
  }
  // Close trailing incident
  if (incidentStart != null) {
    const end = points[points.length - 1].ts;
    incidents.push({ start: incidentStart, end, durationMs: end - incidentStart });
  }

  const uptimePct = points.length > 0 ? ((points.length - downPoints) / points.length) * 100 : 100;
  const mttrMs = incidents.length > 0
    ? incidents.reduce((s, i) => s + i.durationMs, 0) / incidents.length
    : null;
  const longestOutageMs = incidents.length > 0
    ? Math.max(...incidents.map(i => i.durationMs))
    : null;

  return { uptimePct, totalPoints: points.length, downPoints, incidents, mttrMs, longestOutageMs };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "7d";
  const rangeMs: Record<string, number> = {
    "1h": 3_600_000, "6h": 21_600_000, "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000,
  };
  const ms = rangeMs[range] ?? rangeMs["7d"];

  try {
    const points = await readHistory({ rangeMs: ms, limit: 5000 });

    // Anomalies
    const anomalies: Anomaly[] = [];
    for (const m of METRICS) {
      anomalies.push(...detectAnomalies(points, m));
    }
    anomalies.sort((a, b) => b.zScore - a.zScore);

    // Predictions
    const predictions: Prediction[] = [];
    for (const m of METRICS) {
      const pred = predictTrend(points, m);
      if (pred) predictions.push(pred);
    }

    // SLA
    const sla = computeSla(points);

    return NextResponse.json({
      anomalies: anomalies.slice(0, 50),
      predictions,
      sla,
      range,
      pointCount: points.length,
      timestamp: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
