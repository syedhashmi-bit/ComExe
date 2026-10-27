"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, PageTitle, Segmented } from "@/app/components/PageHeader";
import { AreaChart } from "@/app/components/AreaChart";
import { fmtBytes } from "@/app/lib/formatters";

interface HistoryPoint {
  ts: number;
  cpu?: number | null;
  mem?: number | null;
  net_rx?: number | null;
  net_tx?: number | null;
  gpu?: number | null;
  disk_pct?: number | null;
}

type RangeKey = "1h" | "6h" | "24h" | "7d";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "1h",  label: "1 hour" },
  { key: "6h",  label: "6 hours" },
  { key: "24h", label: "24 hours" },
  { key: "7d",  label: "7 days" },
];

const METRICS: { key: keyof Omit<HistoryPoint, "ts">; label: string; color: string; unit: string; yMax?: number; fmt?: (v: number) => string }[] = [
  { key: "cpu",      label: "CPU Usage",       color: "var(--accent-cpu)",      unit: "%",  yMax: 100 },
  { key: "mem",      label: "Memory Usage",     color: "var(--accent-memory)",   unit: "%",  yMax: 100 },
  { key: "gpu",      label: "GPU Utilization",  color: "var(--accent-gpu)",      unit: "%",  yMax: 100 },
  { key: "disk_pct", label: "Disk Usage (worst)", color: "var(--accent-fs)",    unit: "%",  yMax: 100 },
  { key: "net_rx",   label: "Network RX",       color: "var(--accent-network)", unit: "",   fmt: (v: number) => fmtBytes(v) + "/s" },
  { key: "net_tx",   label: "Network TX",       color: "var(--accent-network-tx)", unit: "",   fmt: (v: number) => fmtBytes(v) + "/s" },
];

function computeStats(data: { value: number | null }[]): { avg: number | null; min: number | null; max: number | null; current: number | null } {
  const vals = data.map(d => d.value).filter((v): v is number => v !== null);
  if (vals.length === 0) return { avg: null, min: null, max: null, current: null };
  return {
    avg: vals.reduce((s, v) => s + v, 0) / vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
    current: vals[vals.length - 1],
  };
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (r: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/history?range=${r}&limit=800`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPoints(data.points ?? []);
    } catch (e) {
      setError((e as Error).message);
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  const changeRange = (r: RangeKey) => {
    setRange(r);
  };

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      <PageHeader current="analytics">
        <Segmented label="Time range" options={RANGES} value={range} onChange={changeRange} />
      </PageHeader>

      {/* Content */}
      <div className="px-3 sm:px-6 py-6 flex flex-col gap-6" style={{ maxWidth: 1560, margin: "0 auto" }}>
        <PageTitle title="Analytics" description={<>CPU, memory, GPU, disk and network over the last {RANGES.find(r => r.key === range)?.label}.</>} />
        {loading ? (
          <div className="flex items-center justify-center" style={{ height: 400, color: "var(--text-ghost)" }}>
            <div className="flex flex-col items-center gap-3">
              <div className="skeleton" style={{ width: 200, height: 16, borderRadius: 4 }} />
              <span style={{ fontSize: 12 }}>Loading history...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center" style={{ height: 400 }}>
            <div style={{ color: "var(--critical)", fontSize: 13 }}>Failed to load: {error}</div>
          </div>
        ) : points.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3" style={{ height: 400, color: "var(--text-ghost)" }}>
            <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 3v18h18"/><path d="M8 17v-5"/><path d="M13 17V8"/><path d="M18 17v-9"/></svg>
            <span style={{ fontSize: 13 }}>No historical data yet</span>
            <span style={{ fontSize: 12, maxWidth: 360, textAlign: "center", lineHeight: 1.6 }}>
              Metrics are recorded every poll cycle. Data will appear here after a few minutes of dashboard operation.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {METRICS.map(m => {
                const chartData = points.map(p => ({ ts: p.ts, value: (p[m.key] as number | null) ?? null }));
                const stats = computeStats(chartData);
                const fmtVal = m.fmt ?? ((v: number) => `${v.toFixed(1)}${m.unit}`);
                return (
                  <div key={m.key} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                    <div className="flex items-center" style={{ gap: 6, fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: m.color, flexShrink: 0 }} />
                      {m.label}
                    </div>
                    <div className="flex flex-col gap-1">
                      {stats.current !== null ? (
                        <>
                          <div style={{ fontSize: 22, fontWeight: 500, fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-mono, monospace)", color: "var(--text)" }}>
                            {fmtVal(stats.current)}
                          </div>
                          <div className="flex gap-3" style={{ fontSize: 12, color: "var(--text-label)", fontVariantNumeric: "tabular-nums" }}>
                            <span>avg {fmtVal(stats.avg!)}</span>
                            <span>max {fmtVal(stats.max!)}</span>
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-ghost)" }}>&mdash;</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {METRICS.map(m => {
                const chartData = points.map(p => ({ ts: p.ts, value: (p[m.key] as number | null) ?? null }));
                return (
                  <div key={m.key} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px" }}>
                    <AreaChart
                      data={chartData}
                      color={m.color}
                      height={200}
                      label={m.label}
                      unit={m.unit}
                      formatValue={m.fmt}
                      yMax={m.yMax}
                    />
                  </div>
                );
              })}
            </div>

            {/* Data info footer */}
            <div className="flex items-center justify-between" style={{ fontSize: 12, color: "var(--text-ghost)", padding: "4px 0" }}>
              <span>{points.length} data points over {range}</span>
              {points.length > 0 && (
                <span>
                  {new Date(points[0].ts).toLocaleString()} — {new Date(points[points.length - 1].ts).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
