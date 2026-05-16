"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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

interface InsightsData {
  anomalies: Anomaly[];
  predictions: Prediction[];
  sla: SlaStats;
  range: string;
  pointCount: number;
}

type RangeKey = "24h" | "7d" | "30d";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "24h", label: "24 hours" },
  { key: "7d",  label: "7 days" },
  { key: "30d", label: "30 days" },
];

const METRIC_LABELS: Record<string, { label: string; color: string; unit: string }> = {
  cpu:      { label: "CPU",        color: "var(--accent-cpu)",     unit: "%" },
  mem:      { label: "Memory",     color: "var(--accent-memory)",  unit: "%" },
  gpu:      { label: "GPU",        color: "var(--accent-gpu)",     unit: "%" },
  disk_pct: { label: "Disk",       color: "var(--accent-fs)",      unit: "%" },
  net_rx:   { label: "Net RX",     color: "var(--accent-network)", unit: " B/s" },
  net_tx:   { label: "Net TX",     color: "#8b5cf6",               unit: " B/s" },
};

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function TrendArrow({ trend }: { trend: Prediction["trend"] }) {
  if (trend === "stable") return <span style={{ color: "var(--text-ghost)", fontSize: 12 }}>→</span>;
  if (trend === "rising") return <span style={{ color: "var(--warn)", fontSize: 12 }}>↑</span>;
  return <span style={{ color: "var(--ok)", fontSize: 12 }}>↓</span>;
}

export default function ForecastPage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (r: RangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(range); }, [range, fetchData]);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      {/* Header */}
      <div className="sticky top-0 z-30" style={{ background: "var(--header-bg)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--border-dim)" }}>
        <div className="flex items-center gap-4 px-6 py-3" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <Link href="/" style={{ color: "var(--brand)", textDecoration: "none", fontSize: 12, fontWeight: 600 }}>
            &larr; Dashboard
          </Link>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.02em" }}>Insights &amp; Forecasting</span>
          <div className="flex gap-1 ml-auto">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)}
                style={{
                  fontSize: 10, padding: "4px 10px", borderRadius: 5, cursor: "pointer",
                  background: range === r.key ? "var(--brand)" : "var(--card)",
                  color: range === r.key ? "var(--bg)" : "var(--text-dim)",
                  border: `1px solid ${range === r.key ? "var(--brand)" : "var(--border)"}`,
                  fontWeight: range === r.key ? 700 : 400,
                }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-3 sm:px-6 py-6" style={{ maxWidth: 1200, margin: "0 auto" }}>
        {loading ? (
          <div className="flex items-center justify-center" style={{ height: 400, color: "var(--text-ghost)" }}>
            <span style={{ fontSize: 12 }}>Analyzing {range} of history...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center" style={{ height: 400, color: "var(--critical)", fontSize: 13 }}>
            {error}
          </div>
        ) : data ? (
          <div className="flex flex-col gap-6">

            {/* ── SLA Overview ── */}
            <div style={{ background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: "20px 24px" }}>
              <div className="flex items-center gap-2 mb-4">
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-dim)" }}>
                  SLA Report
                </span>
                <span style={{ fontSize: 9, color: "var(--text-ghost)" }}>last {range}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                <div className="flex flex-col gap-1">
                  <span style={{ fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase" }}>Uptime</span>
                  <span style={{
                    fontSize: 28, fontWeight: 700, fontFamily: "monospace", fontVariantNumeric: "tabular-nums",
                    color: data.sla.uptimePct >= 99.9 ? "var(--ok)" : data.sla.uptimePct >= 99 ? "var(--warn)" : "var(--critical)",
                  }}>
                    {data.sla.uptimePct.toFixed(2)}%
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span style={{ fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase" }}>Incidents</span>
                  <span style={{ fontSize: 28, fontWeight: 700, fontFamily: "monospace", color: data.sla.incidents.length > 0 ? "var(--warn)" : "var(--text-mid)" }}>
                    {data.sla.incidents.length}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span style={{ fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase" }}>MTTR</span>
                  <span style={{ fontSize: 20, fontWeight: 600, fontFamily: "monospace", color: "var(--text-mid)" }}>
                    {fmtDuration(data.sla.mttrMs)}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span style={{ fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase" }}>Longest outage</span>
                  <span style={{ fontSize: 20, fontWeight: 600, fontFamily: "monospace", color: "var(--text-mid)" }}>
                    {fmtDuration(data.sla.longestOutageMs)}
                  </span>
                </div>
              </div>

              {data.sla.incidents.length > 0 && (
                <div className="flex flex-col gap-1" style={{ borderTop: "1px solid var(--border-dim)", paddingTop: 12 }}>
                  <span style={{ fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase", marginBottom: 4 }}>Incident timeline</span>
                  {data.sla.incidents.slice(0, 10).map((inc, i) => (
                    <div key={i} className="flex items-center gap-3" style={{ fontSize: 10 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--critical)", flexShrink: 0 }} />
                      <span style={{ color: "var(--text-muted)", fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>
                        {fmtTime(inc.start)}
                      </span>
                      <span style={{ color: "var(--text-ghost)" }}>—</span>
                      <span style={{ color: "var(--text-muted)", fontFamily: "monospace" }}>{fmtTime(inc.end)}</span>
                      <span style={{ color: "var(--text-ghost)", marginLeft: "auto" }}>{fmtDuration(inc.durationMs)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 12, fontSize: 9, color: "var(--text-ghost)" }}>
                Based on {data.pointCount} data points over {range}
              </div>
            </div>

            {/* ── Predictions ── */}
            <div style={{ background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: "20px 24px" }}>
              <div className="flex items-center gap-2 mb-4">
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-dim)" }}>
                  Resource Forecasting
                </span>
              </div>

              {data.predictions.length === 0 ? (
                <div style={{ padding: "16px 0", color: "var(--text-ghost)", fontSize: 11 }}>
                  Not enough historical data for predictions yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data.predictions.map(pred => {
                    const info = METRIC_LABELS[pred.metric] ?? { label: pred.metric, color: "var(--text)", unit: "" };
                    return (
                      <div key={pred.metric} style={{
                        background: "var(--surface)", border: "1px solid var(--border-subtle)",
                        borderRadius: 8, padding: "12px 14px",
                      }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: info.color }} />
                          <span style={{ fontSize: 10, fontWeight: 600, color: info.color, textTransform: "uppercase" }}>
                            {info.label}
                          </span>
                          <TrendArrow trend={pred.trend} />
                        </div>
                        <div className="flex items-baseline gap-2 mb-1">
                          <span style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace", fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
                            {pred.currentValue.toFixed(1)}{info.unit}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5" style={{ fontSize: 9, color: "var(--text-ghost)" }}>
                          <span>
                            {pred.trend === "stable" ? "Stable" :
                              `${pred.trend === "rising" ? "+" : ""}${pred.ratePerDay.toFixed(2)}${info.unit}/day`
                            }
                          </span>
                          {pred.daysUntilFull != null && (
                            <span style={{ color: pred.daysUntilFull < 30 ? "var(--warn)" : "var(--text-ghost)" }}>
                              ~{pred.daysUntilFull.toFixed(0)} days until full
                            </span>
                          )}
                        </div>
                        {pred.warning && (
                          <div style={{
                            marginTop: 8, fontSize: 9, padding: "4px 8px", borderRadius: 4,
                            background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)",
                            color: "var(--warn)",
                          }}>
                            {pred.warning}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Anomalies ── */}
            <div style={{ background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: "20px 24px" }}>
              <div className="flex items-center gap-2 mb-4">
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-dim)" }}>
                  Anomaly Detection
                </span>
                <span style={{
                  fontSize: 9, padding: "2px 6px", borderRadius: 3,
                  background: data.anomalies.length > 0 ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)",
                  color: data.anomalies.length > 0 ? "var(--critical)" : "var(--ok)",
                  fontWeight: 600,
                }}>
                  {data.anomalies.length === 0 ? "No anomalies" : `${data.anomalies.length} detected`}
                </span>
              </div>

              {data.anomalies.length === 0 ? (
                <div className="flex items-center gap-2" style={{ padding: "12px 0", color: "var(--text-ghost)", fontSize: 11 }}>
                  <span style={{ fontSize: 16 }}>&#x2705;</span>
                  <span>All metrics within normal bounds (z-score &lt; 3)</span>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {data.anomalies.slice(0, 20).map((a, i) => {
                    const info = METRIC_LABELS[a.metric] ?? { label: a.metric, color: "var(--text)", unit: "" };
                    return (
                      <div key={`${a.metric}-${a.ts}-${i}`} className="flex items-center gap-3"
                        style={{ padding: "6px 8px", borderRadius: 4, fontSize: 10 }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: info.color, flexShrink: 0 }} />
                        <span style={{ color: info.color, fontWeight: 600, minWidth: 50 }}>{info.label}</span>
                        <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", color: "var(--text-muted)" }}>
                          {fmtTime(a.ts)}
                        </span>
                        <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--critical)" }}>
                          {a.value.toFixed(1)}{info.unit}
                        </span>
                        <span style={{ color: "var(--text-ghost)" }}>
                          (avg {a.mean.toFixed(1)}, z={a.zScore.toFixed(1)})
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        ) : null}
      </div>
    </div>
  );
}
