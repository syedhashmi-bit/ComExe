"use client";

import { useEffect, useState } from "react";

// ── DevicesPanel ─────────────────────────────────────────────────────────────
// Lists the DHCP leases from MikroTik. Each row shows hostname/MAC/IP,
// online status (last-seen within 5 min), and a Wake button for offline
// devices. Collapsed by default to keep the dashboard tight — click the
// header to expand.

interface DeviceRow {
  mac:         string;
  ip:          string;
  hostname:    string | null;
  comment:     string | null;
  online:      boolean;
  lastSeenSec: number | null;
  dynamic:     boolean;
}

function fmtLastSeen(sec: number | null, online: boolean): string {
  if (online) return "online";
  if (sec == null) return "—";
  if (sec < 3600)   return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400)  return `${Math.round(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.round(sec / 86400)}d ago`;
  return `${Math.round(sec / 604800)}w ago`;
}

export function DevicesPanel() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [open,    setOpen]    = useState(false);
  const [wakingMac, setWakingMac] = useState<string | null>(null);
  const [wakeMsg,   setWakeMsg]   = useState<{ mac: string; ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/mikrotik/devices", { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(body.error ?? `HTTP ${res.status}`); setDevices(null); return; }
        setDevices(body.devices ?? []);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [open]);

  async function wake(mac: string) {
    setWakingMac(mac);
    setWakeMsg(null);
    try {
      const res = await fetch("/api/mikrotik/wol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac }),
      });
      const body = await res.json();
      setWakeMsg({ mac, ok: !!body.ok, text: body.message ?? (body.ok ? "Sent" : "Failed") });
    } catch (e) {
      setWakeMsg({ mac, ok: false, text: (e as Error).message });
    } finally {
      setWakingMac(null);
    }
  }

  const onlineCount = devices ? devices.filter(d => d.online).length : 0;
  const totalCount  = devices ? devices.length : 0;

  return (
    <div style={{
      background: "var(--surface-dim)", border: "1px solid var(--border-subtle)",
      borderRadius: 14, padding: open ? "16px 20px" : "10px 20px",
      transition: "padding 0.15s",
    }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: "none", cursor: "pointer", color: "var(--text)", padding: 0, textAlign: "left" }}>
        <span style={{ fontSize: 14, color: "var(--text-faint)", width: 12, textAlign: "center" }}>{open ? "▾" : "▸"}</span>
        <span className="text-[10px] uppercase" style={{ color: "var(--text-label)", letterSpacing: "0.15em" }}>devices</span>
        {totalCount > 0 && (
          <span style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "var(--ok)", fontWeight: 600 }}>
            {onlineCount} / {totalCount} online
          </span>
        )}
        {!open && totalCount === 0 && devices === null && (
          <span className="text-[9px]" style={{ color: "var(--text-ghost)" }}>click to load</span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          {error && (
            <div style={{ fontSize: 11, color: "var(--critical)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
              {error}
            </div>
          )}
          {!devices && !error && (
            <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>loading devices…</div>
          )}
          {devices && devices.length === 0 && (
            <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>no DHCP leases found</div>
          )}
          {devices && devices.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px 90px 80px", gap: "4px 12px", alignItems: "center", fontSize: 10 }}>
              <div style={{ color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 9 }}>host</div>
              <div style={{ color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 9 }}>ip · mac</div>
              <div style={{ color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 9 }}>last seen</div>
              <div style={{ color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 9 }}>status</div>
              <div></div>
              {devices.map(d => (
                <div key={d.mac} style={{ display: "contents" }}>
                  <div style={{ color: "var(--text)", fontWeight: 500, gridColumn: 1, paddingTop: 8, paddingBottom: 4, borderTop: "1px solid var(--divider)" }}>
                    {d.hostname || d.comment || <span style={{ color: "var(--text-faint)" }}>—</span>}
                  </div>
                  <div style={{ color: "var(--text-dim)", fontFamily: "monospace", fontSize: 10, gridColumn: 2, paddingTop: 8, paddingBottom: 4, borderTop: "1px solid var(--divider)" }}>
                    {d.ip} · {d.mac.toLowerCase()}
                  </div>
                  <div style={{ color: "var(--text-faint)", fontFamily: "monospace", fontSize: 10, gridColumn: 3, paddingTop: 8, paddingBottom: 4, borderTop: "1px solid var(--divider)" }}>
                    {fmtLastSeen(d.lastSeenSec, d.online)}
                  </div>
                  <div style={{ gridColumn: 4, paddingTop: 8, paddingBottom: 4, borderTop: "1px solid var(--divider)" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 9, fontWeight: 600,
                      color: d.online ? "var(--ok)" : "var(--text-faint)",
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: d.online ? "var(--ok)" : "var(--text-ghost)" }} />
                      {d.online ? "online" : "offline"}
                    </span>
                  </div>
                  <div style={{ gridColumn: 5, paddingTop: 8, paddingBottom: 4, borderTop: "1px solid var(--divider)" }}>
                    {!d.online && (
                      <button onClick={() => wake(d.mac)} disabled={wakingMac === d.mac}
                        style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, background: "var(--brand)", color: "#0a0c12", border: "none", cursor: wakingMac === d.mac ? "wait" : "pointer", fontWeight: 600 }}>
                        {wakingMac === d.mac ? "…" : "Wake"}
                      </button>
                    )}
                  </div>
                  {wakeMsg?.mac === d.mac && (
                    <div style={{ gridColumn: "1 / -1", fontSize: 9, color: wakeMsg.ok ? "var(--ok)" : "var(--critical)", paddingBottom: 4 }}>
                      {wakeMsg.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
