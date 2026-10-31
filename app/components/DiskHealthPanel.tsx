"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePollingInterval } from "@/app/hooks/usePolling";
import { isDemoMode } from "@/app/lib/demo-data";

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

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 24) return `${h}h`;
  if (h < 8760) return `${(h / 24).toFixed(0)}d`;
  return `${(h / 8760).toFixed(1)}y`;
}

function tempColor(t: number): string {
  if (t >= 55) return "var(--critical)";
  if (t >= 45) return "var(--warn)";
  return "var(--ok)";
}

// Remembers "Hide" on the not-set-up hint. Only that hint: once the exporter
// reports disks the panel shows again regardless.
const HINT_KEY = "comexe:smart-hint-hidden";

function readHintHidden(): boolean {
  try { return typeof window !== "undefined" && localStorage.getItem(HINT_KEY) === "1"; }
  catch { return false; }
}

// The panel draws its own card, so the not-set-up state can be a slim strip
// (or nothing) instead of a full-width card announcing an absence.
function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
      {children}
    </div>
  );
}

export function DiskHealthPanel() {
  const [disks, setDisks] = useState<SmartDisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Safe to read in the initializer: the first render is always the loading
  // state, which doesn't depend on it, so server and client markup match.
  const [hintHidden, setHintHidden] = useState(readHintHidden);

  function hideHint() {
    setHintHidden(true);
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* private mode etc. */ }
  }

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch("/api/smart");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDisks(data.disks ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // /api/smart queries Prometheus, so this must not run in demo mode — this
  // panel renders on the main dashboard and was the reason `?demo=1` still
  // produced upstream traffic.
  usePollingInterval(fetch_, 60_000, { enabled: !isDemoMode() });

  // Nothing while the first fetch runs: most installs have no exporter, and a
  // card that appears only to shrink into a one-line hint is worse than a beat
  // of empty space below the fold.
  if (loading) return null;

  if (error || disks.length === 0) {
    if (!error && hintHidden) return null;
    return (
      <div className="flex items-center gap-2" style={{
        border: "1px dashed var(--border)", borderRadius: 10, padding: "7px 14px",
        fontSize: 12, color: "var(--text-label)", minWidth: 0,
      }}>
        <svg className="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
          <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
        </svg>
        <span className="shrink-0" style={{ color: "var(--text-secondary)", fontWeight: 600 }}>Disk health</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-ghost)" }}>
          {error
            ? `unavailable · ${error}`
            : "not set up · install the smartmon exporter to see disk temps and sector errors"}
        </span>
        {!error && (
          <button onClick={hideHint} className="shrink-0" style={{
            marginLeft: "auto", fontSize: 12, color: "var(--text-label)", background: "none",
            border: "1px solid var(--border)", borderRadius: 5, padding: "2px 8px", cursor: "pointer",
          }}>Hide</button>
        )}
      </div>
    );
  }

  const allHealthy = disks.every(d => d.healthy);

  return (
    <Frame>
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-fs)" }}>
            <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Disk health
          </span>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 600,
          color: allHealthy ? "var(--ok)" : "var(--critical)",
        }}>
          {allHealthy ? "All healthy" : "Issues detected"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {disks.map(disk => (
          <div key={disk.device} style={{
            background: "var(--surface)", border: "1px solid var(--border-subtle)",
            borderRadius: 8, padding: "10px 12px",
          }}>
            <div className="flex items-center gap-2 mb-2">
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: disk.healthy ? "var(--ok)" : "var(--critical)",
              }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: "monospace" }}>
                {disk.device}
              </span>
              <span title={disk.model} style={{ fontSize: 12, color: "var(--text-ghost)", marginLeft: "auto", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {disk.model}
              </span>
            </div>

            <div className="flex gap-3 flex-wrap" style={{ fontSize: 12 }}>
              {disk.temperature != null && (
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--text-ghost)" }}>Temp</span>
                  <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: tempColor(disk.temperature) }}>
                    {disk.temperature}°C
                  </span>
                </div>
              )}
              {disk.powerOnHours != null && (
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--text-ghost)" }}>Age</span>
                  <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", color: "var(--text-mid)" }}>
                    {fmtHours(disk.powerOnHours)}
                  </span>
                </div>
              )}
              {disk.reallocatedSectors != null && (
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--text-ghost)" }}>Realloc</span>
                  <span style={{
                    fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontWeight: 600,
                    color: disk.reallocatedSectors > 0 ? "var(--critical)" : "var(--text-mid)",
                  }}>
                    {disk.reallocatedSectors}
                  </span>
                </div>
              )}
              {disk.pendingSectors != null && disk.pendingSectors > 0 && (
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--text-ghost)" }}>Pending</span>
                  <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--critical)" }}>
                    {disk.pendingSectors}
                  </span>
                </div>
              )}
              {disk.uncorrectableSectors != null && disk.uncorrectableSectors > 0 && (
                <div className="flex items-center gap-1">
                  <span style={{ color: "var(--text-ghost)" }}>Uncorr</span>
                  <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--critical)" }}>
                    {disk.uncorrectableSectors}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
    </Frame>
  );
}
