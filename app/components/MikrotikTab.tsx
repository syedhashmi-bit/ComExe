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

// Default matches the documented MikroTik interval (15s). It used to default
// to 5s, and since `settings.refreshOverrides.mikrotik` is undefined unless the
// user explicitly sets it, that 5s was what everyone actually got — 3× the
// documented rate, and below the 10s floor /api/stream enforces.
const MIKROTIK_DEFAULT_SEC = 15;
const MIKROTIK_MIN_SEC     = 10;

export function MikrotikTab({ mikrotikUrl, refreshSec, demoMode = false }: {
  mikrotikUrl: string;
  refreshSec?: number;
  demoMode?: boolean;
}) {
  const [data, setData] = useState<MtData | null>(null);
  const [corsBlocked, setCorsBlocked] = useState(false);
  // Distinguishes "first fetch hasn't finished" from "fetch failed". Without
  // it, `!data` was treated as failure, so the failure branch rendered on every
  // single page load — see the comment on that branch below.
  const [loading, setLoading] = useState(true);
  // Why the last fetch failed, shown on the unreachable strip so a bad
  // password and a router that's offline don't look the same.
  const [error, setError] = useState<string | null>(null);
  const mikrotikHost = mikrotikUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  useEffect(() => {
    // Demo mode is documented as bypassing all API polling. This component was
    // the one holdout, so `?demo=1` still hit the real router every few
    // seconds during demos and screenshots.
    if (demoMode) return;

    async function load() {
      try {
        const res = await fetch("/api/mikrotik", { cache: "no-store" });
        // Error responses carry the reason ("credentials not set", a refused
        // connection, …) in the body; prefer it over the bare status code.
        const d = await res.json().catch(() => ({})) as MtData & { error?: string };
        if (!res.ok || d.error) throw new Error(d.error ?? "HTTP " + res.status);
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
        setError(null);
      } catch (e) {
        setCorsBlocked(true);
        setError((e as Error).message || null);
      } finally {
        setLoading(false);
      }
    }
    const everySec = Math.max(MIKROTIK_MIN_SEC, refreshSec || MIKROTIK_DEFAULT_SEC);

    load();
    let id: ReturnType<typeof setInterval> | null = setInterval(load, everySec * 1000);

    // Don't poll the router while the tab is backgrounded.
    const onVis = () => {
      if (document.hidden) {
        if (id) { clearInterval(id); id = null; }
      } else if (!id) {
        load();
        id = setInterval(load, everySec * 1000);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (id) clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshSec, demoMode]);

  const pill = (label: string, value: string, pctVal?: number, tempVal?: number | null) => {
    const tempColor = tempVal == null ? null : tempVal > 80 ? "var(--critical)" : tempVal > 60 ? "var(--warn)" : "var(--ok)";
    return (
      <div key={label} className="flex items-center gap-2 shrink-0">
        <span style={{ color: "var(--text-label)", fontSize: 12 }}>{label}</span>
        <span style={{ color: tempColor ?? "rgba(255,255,255,0.9)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{value}</span>
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


  // Shown while the first fetch is in flight, and when the router can't be
  // reached. It used to render hardcoded literals here — `"RouterOS 7.22.1"`
  // and `"Uptime 13d 4h"` — so a user saw a plausible, completely fabricated
  // uptime on every page load before real data arrived, and permanently
  // whenever the router was unreachable. Values are only ever shown now if
  // they came from the router.
  //
  // It's a slim strip rather than the full stats bar: a failure state
  // shouldn't take as much room as live data, but the reason belongs on it.
  if (corsBlocked || !data) {
    const down = !loading;
    return (
      <a href={mikrotikUrl} target="_blank" rel="noopener noreferrer"
        className="flex flex-wrap items-center w-full"
        title={down && error ? `MikroTik: ${error}` : undefined}
        style={{
          columnGap: 8, rowGap: 4,
          border: "1px dashed var(--border)", borderRadius: 10, padding: "7px 14px",
          textDecoration: "none", cursor: "pointer", minWidth: 0,
          transition: "border-color 0.2s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-hover)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
      >
        <span className="shrink-0" style={{ width: 6, height: 6, borderRadius: 3, background: down ? "var(--warn)" : "var(--text-ghost)" }} />
        <span className="shrink-0" style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: 12 }}>MikroTik</span>
        <span className="shrink-0 font-mono" style={{ color: "var(--text-label)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{mikrotikHost}</span>
        <span className="shrink-0" style={{ color: down ? "var(--warn)" : "var(--text-label)", fontSize: 12 }}>
          {down ? "unreachable" : <>connecting&hellip;</>}
        </span>
        {down && error && (
          <span style={{ color: "var(--text-ghost)", fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            · {error}
          </span>
        )}
        <span className="shrink-0" style={{ color: "var(--text-ghost)", fontSize: 12, marginLeft: "auto" }}>open ↗</span>
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
      <span style={{ color: "var(--text-ghost)", fontSize: 12, marginLeft: "auto", flexShrink: 0 }}>tap to open ↗</span>
    </a>
  );
}
