"use client";

import { useEffect, useState } from "react";

interface MtData {
  board: string | null;
  version: string | null;
  cpu: number | null;
  ramUsed: string | null;
  ramTotal: string | null;
  ramPct: number | null;
  hddUsed: number | null;
  hddTotal: number | null;
  uptime: string | null;
  temp: number | null;
}

export function MikrotikTab({ mikrotikUrl, refreshSec = 5 }: { mikrotikUrl: string; refreshSec?: number }) {
  const [data, setData] = useState<MtData | null>(null);
  const [corsBlocked, setCorsBlocked] = useState(false);
  const mikrotikHost = mikrotikUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/mikrotik", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const d = await res.json() as MtData & { error?: string };
        if (d.error) throw new Error(d.error);
        setData({
          board:    d.board,
          version:  d.version,
          cpu:      d.cpu,
          ramUsed:  d.ramUsed,
          ramTotal: d.ramTotal,
          ramPct:   d.ramPct,
          hddUsed:  d.hddUsed,
          hddTotal: d.hddTotal,
          uptime:   d.uptime,
          temp:     d.temp,
        });
        setCorsBlocked(false);
      } catch {
        setCorsBlocked(true);
      }
    }
    load();
    const id = setInterval(load, Math.max(1, refreshSec) * 1000);
    return () => clearInterval(id);
  }, [refreshSec]);

  const pill = (label: string, value: string, pctVal?: number, tempVal?: number | null) => {
    const tempColor = tempVal == null ? null : tempVal > 80 ? "var(--critical)" : tempVal > 60 ? "var(--warn)" : "var(--ok)";
    return (
      <div key={label} className="flex items-center gap-2 shrink-0">
        <span style={{ color: "var(--text-label)", fontSize: 10 }}>{label}</span>
        <span style={{ color: tempColor ?? "rgba(255,255,255,0.9)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {pctVal != null && (
          <div style={{ width: 36, height: 3, background: "var(--border-mid)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${pctVal}%`, height: "100%", background: pctVal > 85 ? "var(--critical)" : pctVal > 65 ? "var(--warn)" : "var(--settings-active)", borderRadius: 2 }} />
          </div>
        )}
      </div>
    );
  };

  const sep = () => <span style={{ color: "var(--text-hidden)", fontSize: 14, userSelect: "none" }}>|</span>;

  const fmtMtBytes = (b: number | null) => {
    if (b == null) return "—";
    if (b < 1e6) return `${(b / 1e3).toFixed(0)} KB`;
    if (b < 1e9) return `${(b / 1e6).toFixed(0)} MB`;
    return `${(b / 1e9).toFixed(1)} GB`;
  };

  const staticSep = () => <span style={{ color: "var(--text-hidden)", fontSize: 14, userSelect: "none", flexShrink: 0 }}>|</span>;
  const staticPill = (label: string, value: string) => (
    <div className="flex items-center gap-1.5 shrink-0">
      <span style={{ color: "var(--text-label)", fontSize: 10 }}>{label}</span>
      <span style={{ color: "var(--text-secondary)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );

  if (corsBlocked || !data) {
    return (
      <a href={mikrotikUrl} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-4 w-full overflow-x-auto"
        style={{
          background: "var(--mt-bg)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "12px 20px",
          textDecoration: "none", cursor: "pointer",
          transition: "border-color 0.2s, background 0.2s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-hover)"; e.currentTarget.style.background = "var(--mt-bg-hover)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--mt-bg)"; }}
      >
        <div className="flex items-center gap-2 shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--brand)" }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="9" width="22" height="7" rx="2"/>
            <line x1="5" y1="9" x2="5" y2="16"/><line x1="9" y1="9" x2="9" y2="16"/>
            <circle cx="16.5" cy="12.5" r="1" style={{ fill: "var(--brand)" }} stroke="none"/>
            <circle cx="19.5" cy="12.5" r="1" style={{ fill: "var(--brand)" }} stroke="none"/>
            <line x1="7" y1="5" x2="7" y2="9"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="17" y1="5" x2="17" y2="9"/>
          </svg>
          <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 14 }}>MikroTik</span>
          <span style={{ color: "var(--text-label)", fontSize: 11 }}>hAP ax³</span>
        </div>
        {staticSep()}
        {staticPill("RouterOS", "7.22.1")}
        {staticSep()}
        {staticPill("IP", mikrotikHost)}
        {staticSep()}
        {staticPill("CPU", "—")}
        {staticSep()}
        {staticPill("RAM", "—")}
        {staticSep()}
        {staticPill("Uptime", "13d 4h")}
        <span style={{ color: "var(--text-ghost)", fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>tap to open ↗</span>
      </a>
    );
  }

  const cpuPct = data.cpu ?? 0;
  const memPct = data.ramPct ?? 0;
  const hddPct = data.hddTotal && data.hddUsed ? (data.hddUsed / data.hddTotal) * 100 : 0;

  return (
    <a href={mikrotikUrl} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-4 w-full overflow-x-auto"
      style={{
        background: "var(--mt-bg)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "12px 20px", textDecoration: "none", cursor: "pointer",
        transition: "border-color 0.2s, background 0.2s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-hover)"; e.currentTarget.style.background = "var(--mt-bg-hover)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--mt-bg)"; }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--brand)" }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="9" width="22" height="7" rx="2"/>
          <line x1="5" y1="9" x2="5" y2="16"/><line x1="9" y1="9" x2="9" y2="16"/>
          <circle cx="16.5" cy="12.5" r="1" style={{ fill: "var(--brand)" }} stroke="none"/>
          <circle cx="19.5" cy="12.5" r="1" style={{ fill: "var(--brand)" }} stroke="none"/>
          <line x1="7" y1="5" x2="7" y2="9"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="17" y1="5" x2="17" y2="9"/>
        </svg>
        <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 14 }}>MikroTik</span>
      </div>
      {sep()}
      {data.board && pill("Model", data.board)}
      {data.version && <>{sep()}{pill("RouterOS", data.version)}</>}
      {data.cpu != null && <>{sep()}{pill("CPU", `${data.cpu}%`, cpuPct)}</>}
      {data.ramTotal != null && <>{sep()}{pill("RAM", `${data.ramUsed ?? "—"} / ${data.ramTotal}`, memPct)}</>}
      {data.hddTotal != null && <>{sep()}{pill("Storage", `${fmtMtBytes(data.hddUsed)} / ${fmtMtBytes(data.hddTotal)}`, hddPct)}</>}
      {data.uptime && <>{sep()}{pill("Uptime", data.uptime)}</>}
      {data.temp != null && <>{sep()}{pill("Temp", `${data.temp}°C`, undefined, data.temp)}</>}
      <span style={{ color: "var(--text-ghost)", fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>tap to open ↗</span>
    </a>
  );
}
