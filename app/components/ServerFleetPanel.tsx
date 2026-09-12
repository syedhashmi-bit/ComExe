"use client";

import { useCallback, useEffect, useState } from "react";
import { usePollingInterval } from "@/app/hooks/usePolling";
import { isDemoMode } from "@/app/lib/demo-data";
import { Modal } from "@/app/components/Modal";

interface ServerStatus {
  id: string;
  name: string;
  prometheusUrl: string;
  enabled: boolean;
  reachable: boolean;
  cpu: number | null;
  memPct: number | null;
  uptime: number | null;
  lastChecked: number;
}

function fmtUptime(sec: number | null): string {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function MiniBar({ value, color }: { value: number | null; color: string }) {
  if (value == null) return <span style={{ fontSize: 10, color: "var(--text-ghost)" }}>—</span>;
  return (
    <div className="flex items-center gap-1.5" style={{ minWidth: 60 }}>
      <div style={{ flex: 1, height: 4, background: "var(--border-dim)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, value)}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 9, fontFamily: "monospace", fontVariantNumeric: "tabular-nums", color, fontWeight: 600, minWidth: 24, textAlign: "right" }}>
        {value.toFixed(0)}%
      </span>
    </div>
  );
}

export function ServerFleetPanel({ onClose }: { onClose: () => void }) {
  const [servers, setServers] = useState<ServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  // "Fetch failed" and "you genuinely have no servers" must not render the same
  // way — otherwise a flaky network shows a confident "No additional servers
  // configured". Same reasoning as NotificationCenter, which already does this.
  const [error, setError] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/servers");
      if (!res.ok) { setError(true); return; }
      const data = await res.json();
      setServers(data.servers ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally { setLoading(false); }
  }, []);

  usePollingInterval(fetchServers, 30_000, { enabled: !isDemoMode() });

  async function addServer() {
    if (!newName.trim() || !newUrl.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), prometheusUrl: newUrl.trim() }),
      });
      if (res.ok) {
        setNewName("");
        setNewUrl("");
        setShowAdd(false);
        await fetchServers();
      }
    } catch { /* ignore */ }
    setAdding(false);
  }

  async function removeServer(id: string) {
    await fetch(`/api/servers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await fetchServers();
  }

  async function toggleServer(id: string, enabled: boolean) {
    await fetch("/api/servers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    await fetchServers();
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 10, background: "var(--surface)", color: "var(--text)",
    border: "1px solid var(--border-mid)", borderRadius: 4, padding: "6px 10px",
    outline: "none", width: "100%", fontFamily: "monospace",
  };

  return (
    <>
      <Modal
        onClose={onClose}
        title="Server Fleet"
        width="min(600px, calc(100vw - 40px))"
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
        }
        titleExtra={
          <span style={{ fontSize: 10, color: "var(--text-ghost)" }}>
            {servers.filter(s => s.reachable).length}/{servers.length} online
          </span>
        }
        headerAction={
          <button onClick={() => setShowAdd(v => !v)}
            aria-expanded={showAdd}
            style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "var(--surface)", color: "var(--brand)", border: "1px solid var(--border-mid)", cursor: "pointer", fontWeight: 600 }}>
            + Add
          </button>
        }
      >
        <div style={{ overflow: "auto", flex: 1, padding: 16 }} className="flex flex-col gap-3">
          {showAdd && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border-mid)", borderRadius: 8, padding: 12 }}
              className="flex flex-col gap-2">
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Server name" style={inputStyle} />
              <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="http://192.168.x.x:9090" style={inputStyle} />
              <div className="flex gap-2">
                <button onClick={addServer} disabled={adding || !newName.trim() || !newUrl.trim()}
                  style={{ fontSize: 10, padding: "4px 12px", borderRadius: 4, background: "var(--brand)", color: "var(--bg)", border: "none", cursor: "pointer", fontWeight: 600, opacity: adding ? 0.5 : 1 }}>
                  {adding ? "Adding..." : "Add server"}
                </button>
                <button onClick={() => setShowAdd(false)}
                  style={{ fontSize: 10, padding: "4px 12px", borderRadius: 4, background: "var(--surface)", color: "var(--text-dim)", border: "1px solid var(--border-mid)", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-ghost)", fontSize: 11 }}>
              Loading fleet status...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-8" style={{ color: "var(--warn)" }}>
              <span style={{ fontSize: 12 }}>Couldn&apos;t load the server list</span>
              <span style={{ fontSize: 10, maxWidth: 280, textAlign: "center", lineHeight: 1.6, color: "var(--text-dim)" }}>
                /api/servers didn&apos;t respond. This is a dashboard problem, not a
                report that you have no servers — retrying automatically.
              </span>
            </div>
          ) : servers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8" style={{ color: "var(--text-ghost)" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
                <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
              </svg>
              <span style={{ fontSize: 12 }}>No additional servers configured</span>
              <span style={{ fontSize: 10, maxWidth: 280, textAlign: "center", lineHeight: 1.6 }}>
                Add Prometheus endpoints from other servers to monitor their CPU, memory, and uptime from this dashboard.
              </span>
            </div>
          ) : (
            servers.map(srv => (
              <div key={srv.id} style={{
                background: "var(--surface)", border: "1px solid var(--border-subtle)",
                borderRadius: 10, padding: "12px 14px",
                opacity: srv.enabled ? 1 : 0.5,
              }}>
                <div className="flex items-center gap-2 mb-2">
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: !srv.enabled ? "var(--text-ghost)" : srv.reachable ? "var(--ok)" : "var(--critical)",
                    boxShadow: srv.reachable && srv.enabled ? "0 0 4px var(--ok)" : "none",
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1 }}>{srv.name}</span>
                  <button onClick={() => toggleServer(srv.id, !srv.enabled)}
                    style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "transparent", color: "var(--text-ghost)", border: "1px solid var(--border-dim)", cursor: "pointer" }}>
                    {srv.enabled ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => removeServer(srv.id)}
                    style={{ fontSize: 11, padding: "0 4px", background: "transparent", color: "var(--text-ghost)", border: "none", cursor: "pointer" }}>
                    &times;
                  </button>
                </div>

                {srv.enabled && srv.reachable && (
                  <div className="flex gap-4 flex-wrap" style={{ fontSize: 10 }}>
                    <div className="flex flex-col gap-1">
                      <span style={{ color: "var(--text-ghost)", fontSize: 9 }}>CPU</span>
                      <MiniBar value={srv.cpu} color="var(--accent-cpu)" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span style={{ color: "var(--text-ghost)", fontSize: 9 }}>MEM</span>
                      <MiniBar value={srv.memPct} color="var(--accent-memory)" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span style={{ color: "var(--text-ghost)", fontSize: 9 }}>UPTIME</span>
                      <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", color: "var(--text-mid)", fontSize: 10 }}>
                        {fmtUptime(srv.uptime)}
                      </span>
                    </div>
                  </div>
                )}

                {srv.enabled && !srv.reachable && (
                  <span style={{ fontSize: 10, color: "var(--critical)" }}>Unreachable</span>
                )}

                <div style={{ fontSize: 8, color: "var(--text-ghost)", marginTop: 6, fontFamily: "monospace" }}>
                  {srv.prometheusUrl}
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
