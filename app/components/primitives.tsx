"use client";

// ── Primitive UI components ──────────────────────────────────────────────────
// Shared building blocks: gauges, sparklines, cards, animated numbers, etc.
// No data-fetching or business logic — pure presentational.

import React, { useEffect, useId, useRef, useState } from "react";
import type { AlertLevel, DataUnit } from "@/app/lib/types";
import { fmtBytes } from "@/app/lib/formatters";

// ── AnimatedNumber ───────────────────────────────────────────────────────────
// Interpolates between value changes (~600ms ease-out cubic). Preserves the
// formatting of the source string (commas, decimals).

export function AnimatedNumber({ value, decimals = 0, useCommas = true }: { value: number; decimals?: number; useCommas?: boolean }) {
  const [displayed, setDisplayed] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const start = prevRef.current;
    const end   = value;
    if (start === end) return;
    const duration = 600;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(start + (end - start) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = end;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const out = decimals > 0 ? displayed.toFixed(decimals) : Math.round(displayed).toString();
  if (!useCommas) return <>{out}</>;
  const [whole, frac] = out.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return <>{frac ? `${withCommas}.${frac}` : withCommas}</>;
}

// ── animatedLine ─────────────────────────────────────────────────────────────
// Replaces every numeric literal in `line` with an <AnimatedNumber>.

export function animatedLine(line: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/g;
  let lastIdx = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > lastIdx) parts.push(line.slice(lastIdx, m.index));
    const literal  = m[0];
    const useCommas = literal.includes(",");
    const decimals  = literal.includes(".") ? (literal.split(".")[1].length) : 0;
    const value     = parseFloat(literal.replace(/,/g, ""));
    parts.push(<AnimatedNumber key={`${keyPrefix}-n${i++}`} value={value} decimals={decimals} useCommas={useCommas} />);
    lastIdx = m.index + literal.length;
  }
  if (lastIdx < line.length) parts.push(line.slice(lastIdx));
  return parts;
}

// ── TrendDelta ───────────────────────────────────────────────────────────────

export function TrendDelta({
  history, current, goodDirection = "down", lookback = 6, suffix = "", precision = 1, threshold = 0.1,
}: {
  history: (number | null | undefined)[]; current: number | null | undefined;
  goodDirection?: "up" | "down"; lookback?: number;
  suffix?: string; precision?: number; threshold?: number;
}) {
  if (current == null || history.length < lookback) return null;
  const past = history[history.length - lookback];
  if (past == null) return null;
  const delta = current - past;
  if (Math.abs(delta) < threshold) return null;
  if (current !== 0 && Math.abs(delta) / Math.abs(current) > 5) return null;
  const isUp = delta > 0;
  const isGood = (isUp && goodDirection === "up") || (!isUp && goodDirection === "down");
  const color = isGood ? "#10b981" : "#ef4444";
  return (
    <span style={{
      fontSize: 11, color, opacity: 0.9, fontWeight: 600,
      fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
      letterSpacing: "0.01em",
    }}>
      {isUp ? "↑" : "↓"} {Math.abs(delta).toFixed(precision)}{suffix}
    </span>
  );
}

// ── HeroStat ─────────────────────────────────────────────────────────────────

export function HeroStat({ line, keyPrefix }: { line: string; keyPrefix: string }) {
  const m = line.match(/^(.*?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(.*)$/);
  if (!m) {
    return <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{line}</span>;
  }
  const [, prefix, numStr, rest] = m;
  const useCommas = numStr.includes(",");
  const decimals  = numStr.includes(".") ? numStr.split(".")[1].length : 0;
  const value     = parseFloat(numStr.replace(/,/g, ""));
  return (
    <div className="flex items-baseline gap-1.5 flex-wrap">
      {prefix && <span style={{ fontSize: 11, color: "var(--text-label)" }}>{prefix.trim()}</span>}
      <span style={{
        fontSize: 19, fontWeight: 700, color: "var(--text)",
        fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em", lineHeight: 1.1,
      }}>
        <AnimatedNumber value={value} decimals={decimals} useCommas={useCommas} />
      </span>
      {rest && <span style={{
        fontSize: 11, color: "var(--text-dim)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{animatedLine(rest, `${keyPrefix}-rest`)}</span>}
    </div>
  );
}

// ── GaugeBar ─────────────────────────────────────────────────────────────────

export function GaugeBar({ percent, color, thin = false, gradient }: { percent: number; color: string; thin?: boolean; gradient?: string }) {
  return (
    <div className="relative w-full rounded-full overflow-hidden" style={{ background: "var(--surface)", height: thin ? 3 : 5 }}>
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${percent}%`, background: gradient ?? color, boxShadow: `0 0 ${thin ? 3 : 6}px ${color}55` }}
      />
    </div>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────

export function Sparkline({ data, color, autoMax = false, height = 32 }: {
  data: number[]; color: string; autoMax?: boolean; height?: number;
}) {
  const uid = useId();
  if (data.length < 2) return <div style={{ height }} />;
  const W = 100, H = height, PAD = 1;
  const maxVal = autoMax ? Math.max(...data, 0.001) : 100;
  const pts = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - Math.min(Math.max(v, 0), maxVal) / maxVal) * (H - PAD * 2);
    return [x.toFixed(2), y.toFixed(2)];
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`;
  const gid  = `sg${uid.replace(/:/g, "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height, display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.5" />
          <stop offset="60%"  stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" opacity="0.18" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" opacity="1" />
    </svg>
  );
}

// ── RadialGauge ──────────────────────────────────────────────────────────────

export function RadialGauge({ percent, color, size = 88 }: { percent: number; color: string; size?: number }) {
  const r = 32, circ = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * circ;
  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 88 88" style={{ transform: "rotate(-90deg)", position: "absolute", inset: 0 }}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--gauge-track)" strokeWidth="6" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${filled.toFixed(2)} ${(circ - filled).toFixed(2)}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px ${color}66)`, transition: "stroke-dasharray 0.7s ease" }}
        />
      </svg>
    </div>
  );
}

// ── ThreeSegmentDonut ────────────────────────────────────────────────────────

export function ThreeSegmentDonut({ usedBytes, cacheBytes, freeBytes, totalBytes, du }: {
  usedBytes: number; cacheBytes: number; freeBytes: number; totalBytes: number; du: DataUnit;
}) {
  const r = 36, circ = 2 * Math.PI * r;
  const safe = (v: number) => (isNaN(v) ? 0 : Math.max(0, v));
  const total = safe(totalBytes);
  const used  = safe(usedBytes);
  const cache = safe(cacheBytes);
  const free  = safe(freeBytes);
  const usedLen  = total > 0 ? (used  / total) * circ : 0;
  const cacheLen = total > 0 ? (cache / total) * circ : 0;
  const freeLen  = total > 0 ? (free  / total) * circ : 0;
  const usedPct  = total > 0 ? (used  / total) * 100  : 0;
  const size = 100;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 88 88" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="44" cy="44" r={r} fill="none" stroke="var(--donut-bg)" strokeWidth="9" />
          {usedLen > 0.1 && (
            <circle cx="44" cy="44" r={r} fill="none" stroke="var(--critical)" strokeWidth="9"
              strokeDasharray={`${usedLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeDashoffset={0}
              style={{ filter: "drop-shadow(0 0 3px var(--critical)44)", transition: "stroke-dasharray 0.7s ease" }}
            />
          )}
          {cacheLen > 0.1 && (
            <circle cx="44" cy="44" r={r} fill="none" stroke="var(--settings-label)" strokeWidth="9"
              strokeDasharray={`${cacheLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeDashoffset={(-usedLen).toFixed(2)}
              style={{ transition: "stroke-dasharray 0.7s ease" }}
            />
          )}
          {freeLen > 0.1 && (
            <circle cx="44" cy="44" r={r} fill="none" stroke="var(--ok)" strokeWidth="9"
              strokeDasharray={`${freeLen.toFixed(2)} ${circ.toFixed(2)}`}
              strokeDashoffset={(-(usedLen + cacheLen)).toFixed(2)}
              style={{ filter: "drop-shadow(0 0 3px #00c85333)", transition: "stroke-dasharray 0.7s ease" }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-medium tabular-nums" style={{ color: "var(--text-secondary)" }}>
            {total > 0 ? `${usedPct.toFixed(0)}%` : "—"}
          </span>
          <span className="text-[9px]" style={{ color: "var(--settings-text-dim)" }}>used</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 w-full">
        {[
          { label: "used",      color: "var(--critical)", bytes: used  },
          { label: "zfs cache", color: "var(--settings-label)", bytes: cache },
          { label: "free",      color: "var(--ok)", bytes: free  },
        ].map(({ label, color, bytes }) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
              <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-label)" }}>{label}</span>
            </div>
            <span className="text-[10px] tabular-nums font-medium" style={{ color: "var(--text-muted)" }}>
              {fmtBytes(bytes, 1, du)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── LabeledBar ───────────────────────────────────────────────────────────────

export function LabeledBar({ label, right, percent, color, gradient }: {
  label: string; right: string; percent: number; color: string; gradient?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-label)" }}>{label}</span>
        <span className="text-xs font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>{right}</span>
      </div>
      <GaugeBar percent={percent} color={color} gradient={gradient} />
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export const CARD_INFO: Record<string, string> = {
  cpu:         "CPU utilization across all cores from Prometheus node_exporter. Warn at 85%, critical at 95%.",
  memory:      "Real memory usage = Total - Available - SReclaimable. ZFS ARC inflates raw MemAvailable on TrueNAS.",
  filesystems: "Disk usage for mounts under the configured FS_PATH_PREFIX. Sorted by fullest first.",
  network:     "Network throughput (rx/tx bytes per second) for the primary NIC, excluding virtual interfaces.",
  gpu:         "NVIDIA GPU metrics from nvidia_smi_exporter. Temp warn at 80°C, critical at 90°C.",
  speedtest:   "Recent speedtest results from SpeedTracker. Tests are scheduled automatically — never triggered by the dashboard.",
  system:      "Basic system info: OS, kernel version, architecture, hostname, and uptime from node_exporter.",
  grafana:     "Embedded Grafana panel. Configure GRAFANA_DASHBOARD_UID and GRAFANA_DATASOURCE_UID to enable.",
};

export function Card({
  label, subtitle, children, accent = "#06b6d4", alertLevel = null,
  icon, expanded = false, onToggle, externalLink, animDelay = 0, info,
}: {
  label: string; subtitle?: string; children: React.ReactNode; accent?: string;
  alertLevel?: AlertLevel; icon?: React.ReactNode; expanded?: boolean; onToggle?: () => void;
  externalLink?: string; animDelay?: number; info?: string;
}) {
  const [hov, setHov] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const borderColor =
    alertLevel === "critical" ? "rgba(239,68,68,0.45)"
    : alertLevel === "warning" ? "rgba(245,158,11,0.4)"
    : hov ? `${accent}55` : "rgba(255,255,255,0.08)";

  const topColor =
    alertLevel === "critical" ? "#ef4444"
    : alertLevel === "warning" ? "#f59e0b"
    : accent;

  const infoText = info ?? CARD_INFO[label.toLowerCase()] ?? null;

  return (
    <div
      className="flex flex-col cursor-pointer h-full relative overflow-hidden"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={externalLink ? () => window.open(externalLink, "_blank") : onToggle}
      style={{
        background: `radial-gradient(ellipse at top, ${topColor}14 0%, transparent 55%), rgba(255,255,255,0.04)`,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        border: `1px solid ${borderColor}`,
        borderRadius: 14,
        transform: hov ? "translateY(-3px)" : "translateY(0)",
        boxShadow: hov
          ? `0 12px 36px ${topColor}33, 0 0 0 1px ${topColor}33 inset, 0 8px 32px rgba(0,0,0,0.35)`
          : "none",
        transition: "border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease",
        animation: "fadeSlideIn 0.45s ease both",
        animationDelay: `${animDelay}ms`,
      }}
    >
      <div style={{
        height: 3,
        background: `linear-gradient(90deg, ${topColor} 0%, ${topColor}aa 60%, ${topColor}33 100%)`,
        boxShadow: alertLevel ? `0 0 12px ${topColor}aa` : `0 0 8px ${topColor}66`,
      }} />
      <div className="flex items-center gap-2 overflow-hidden px-[18px] pt-[18px] pb-0">
        {icon && <span style={{ color: accent, opacity: 0.7 }}>{icon}</span>}
        <span className="text-[10px] uppercase shrink-0" style={{ color: "var(--text-label)", letterSpacing: "0.12em" }}>{label}</span>
        {subtitle && <span className="text-[10px] truncate" style={{ color: "var(--text-faint)" }}>{subtitle}</span>}
        {infoText && (
          <span className="relative shrink-0" style={{ lineHeight: 1 }}
            onMouseEnter={e => { e.stopPropagation(); setShowInfo(true); }}
            onMouseLeave={() => setShowInfo(false)}
            onClick={e => { e.stopPropagation(); setShowInfo(v => !v); }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 14, height: 14, borderRadius: 7,
              border: "1px solid var(--border)",
              fontSize: 8, color: "var(--text-ghost)", cursor: "help",
              transition: "color 0.15s, border-color 0.15s",
              ...(showInfo ? { color: accent, borderColor: accent } : {}),
            }}>i</span>
            {showInfo && (
              <div style={{
                position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
                marginTop: 6, width: 220, padding: "8px 10px",
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                fontSize: 10, lineHeight: 1.5, color: "var(--text-secondary)",
                zIndex: 50, pointerEvents: "none",
              }}>{infoText}</div>
            )}
          </span>
        )}
        <span className="ml-auto w-1.5 h-1.5 rounded-full shrink-0" style={{
          background: alertLevel === "critical" ? "#ef4444" : alertLevel === "warning" ? "#f59e0b" : "#10b981",
          boxShadow: alertLevel === "critical" ? "0 0 7px #ef4444aa"
                   : alertLevel === "warning"  ? "0 0 6px #f59e0baa"
                                               : "0 0 5px #10b98166",
          animation: "pulseDot 2s ease-in-out infinite",
        }} />
        <span className="text-[9px]" style={{ color: "var(--text-hidden)" }}>{externalLink ? "↗" : expanded ? "▲" : "▼"}</span>
      </div>
      <div className="px-[18px] pt-3 pb-[18px] flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}

// ── StatusBanner ─────────────────────────────────────────────────────────────

export function StatusBanner({ result, visible }: { result: import("@/app/lib/types").HealthResult; visible: boolean }) {
  const { status, reason } = result;
  if (status === "warning") {
    return (
      <div className="flex items-center gap-3 px-4 rounded-lg"
        style={{
          background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)",
          height: 36, opacity: visible ? 1 : 0, transition: "opacity 0.4s ease",
        }}>
        <span className="block shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--warn)", boxShadow: "0 0 6px #f59e0b66", animation: "pulseDot 2s ease-in-out infinite" }} />
        <span className="text-[10px] tracking-[0.2em] font-semibold uppercase" style={{ color: "var(--warn)" }}>WARNING</span>
        {reason && <span className="text-[10px]" style={{ color: "rgba(245,158,11,0.7)" }}>· {reason}</span>}
      </div>
    );
  }
  if (status === "critical") {
    return (
      <div className="flex items-center gap-3 px-4 rounded-lg"
        style={{
          background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)",
          height: 48, opacity: visible ? 1 : 0, transition: "opacity 0.4s ease",
        }}>
        <span className="text-sm font-bold leading-none" style={{ color: "var(--critical)" }}>✕</span>
        <span className="block shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--critical)", boxShadow: "0 0 8px #ef444466", animation: "pulseDot 2s ease-in-out infinite" }} />
        <span className="text-[10px] tracking-[0.2em] font-semibold uppercase" style={{ color: "var(--critical)" }}>CRITICAL</span>
        {reason && <span className="text-[10px]" style={{ color: "rgba(239,68,68,0.7)" }}>· {reason}</span>}
      </div>
    );
  }
  return null;
}

// ── Small helpers ────────────────────────────────────────────────────────────

export function Skeleton() {
  return <div className="skeleton h-8 w-24 rounded" />;
}

export function BigValue({ value, loading }: { value: string; loading?: boolean }) {
  const [renderKey, setRenderKey] = useState(0);
  const prevRef = useRef(value);
  useEffect(() => {
    if (!loading && value !== prevRef.current) {
      const wasReal = prevRef.current !== "—";
      prevRef.current = value;
      if (wasReal && value !== "—") setRenderKey(k => k + 1);
    }
  }, [value, loading]);
  if (loading) return <Skeleton />;
  return (
    <span
      key={renderKey}
      className="text-3xl font-medium tracking-tight"
      style={{ color: "var(--text)", display: "inline-block", animation: renderKey > 0 ? "valueIn 0.35s ease-out forwards" : "none" }}
    >
      {value}
    </span>
  );
}

export function SubRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs" style={{ color: "var(--text-label)" }}>{label}</span>
      <span className="text-xs font-medium tabular-nums" style={{ color: valueColor ?? "rgba(255,255,255,0.65)" }}>{value}</span>
    </div>
  );
}

export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-label)" }}>{label}</span>
      <span className="text-[10px] tabular-nums font-medium" style={{ color: "var(--text-muted)" }}>{value}</span>
    </div>
  );
}

// ── ServiceIcon ──────────────────────────────────────────────────────────────

export function ServiceIcon({ src, label, color }: { src: string; label: string; color: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
        style={{ background: `${color}22`, color }}>
        {label[0].toUpperCase()}
      </span>
    );
  }
  return (
    <img src={src} alt={label} width={32} height={32}
      className="w-8 h-8 rounded-lg object-contain shrink-0"
      style={{ background: "var(--settings-input)" }}
      onError={() => setErr(true)}
    />
  );
}

// ── BookmarkItem ─────────────────────────────────────────────────────────────

export function BookmarkItem({ name, url, icon }: { name: string; url: string; icon: string }) {
  const [imgErr, setImgErr] = useState(false);
  const fallback = `https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(url).hostname; } catch { return "example.com"; } })()}&sz=32`;
  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2.5 px-2 rounded-lg"
      style={{
        textDecoration: "none", height: 36, flexShrink: 0,
        transition: "background 0.15s ease, transform 0.15s ease",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--card-hover)"; e.currentTarget.style.transform = "translateX(4px)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "translateX(0)"; }}
    >
      {!imgErr ? (
        <img
          src={icon.startsWith("http") ? icon : fallback}
          alt="" width={18} height={18}
          className="rounded shrink-0" style={{ objectFit: "contain", width: 18, height: 18, borderRadius: 4 }}
          onError={(e) => {
            const img = e.currentTarget;
            if (img.src !== fallback) { img.src = fallback; }
            else { setImgErr(true); }
          }}
        />
      ) : (
        <span className="rounded flex items-center justify-center font-bold shrink-0"
          style={{ background: "var(--card-hover)", color: "var(--text-label)", width: 18, height: 18, fontSize: 9 }}>
          {name[0].toUpperCase()}
        </span>
      )}
      <span className="truncate" style={{ color: "var(--text-secondary)", fontSize: 13 }}>{name}</span>
    </a>
  );
}
