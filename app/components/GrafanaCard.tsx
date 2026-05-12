"use client";

import { useState } from "react";
import { IconGrafana } from "@/app/components/icons";

function GrafanaPanel({ url, label, height }: { url: string; label?: string; height: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div style={{ position: "relative", height }}>
      {!loaded && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 8,
          background: "var(--card-alt)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
        }}>
          <span className="text-[11px]" style={{ color: "var(--text-ghost)" }}>loading{label ? ` ${label}` : " panel"}…</span>
        </div>
      )}
      <iframe
        src={url}
        width="100%"
        height={height}
        frameBorder={0}
        style={{
          borderRadius: 8, border: "none", display: "block",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.4s",
        }}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

export function GrafanaCard({ baseUrl, panelUrl, panels }: {
  baseUrl: string;
  panelUrl: string | null;
  panels?: { panelId: string; label: string; size: "sm" | "md" | "lg"; url: string }[];
}) {
  const allPanels = panels && panels.length > 0 ? panels : panelUrl ? [{ panelId: "default", label: "Panel", size: "lg" as const, url: panelUrl }] : [];
  const hasAnyPanel = allPanels.length > 0;

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 14, padding: 18, backdropFilter: "blur(6px)",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--accent-grafana)" }}><IconGrafana /></span>
          <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-label)", letterSpacing: "0.15em" }}>grafana</span>
          {hasAnyPanel && (
            <span className="text-[9px]" style={{ color: "var(--text-ghost)" }}>{allPanels.length} panel{allPanels.length !== 1 ? "s" : ""}</span>
          )}
        </div>
        <a href={baseUrl} target="_blank" rel="noopener noreferrer"
          className="text-[10px]"
          style={{ color: "var(--text-faint)", textDecoration: "none", transition: "color 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--accent-grafana)")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}>
          open grafana ↗
        </a>
      </div>

      {!hasAnyPanel ? (
        <div style={{
          position: "relative", height: 220, borderRadius: 8,
          background: "var(--surface-dim)",
          border: "1px dashed var(--border)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
          padding: 18, textAlign: "center",
        }}>
          <span className="text-[11px]" style={{ color: "var(--text-label)" }}>
            Grafana embed not configured.
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-ghost)", maxWidth: 360, lineHeight: 1.5 }}>
            Set <code style={{ color: "var(--accent-grafana)" }}>GRAFANA_DASHBOARD_UID</code> and <code style={{ color: "var(--accent-grafana)" }}>GRAFANA_DATASOURCE_UID</code> env vars to render a panel here. Use the <a href="/setup" style={{ color: "var(--accent-grafana)" }}>setup wizard</a> to add multiple panels.
          </span>
        </div>
      ) : allPanels.length === 1 ? (
        <GrafanaPanel url={allPanels[0].url} label={allPanels[0].label} height={220} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {allPanels.map((p, i) => {
            const colSpan = p.size === "lg" ? 3 : p.size === "md" ? 2 : 1;
            const h = p.size === "lg" ? 220 : p.size === "md" ? 180 : 150;
            return (
              <div key={p.panelId + i} style={{ gridColumn: `span ${colSpan}` }}>
                {allPanels.length > 1 && (
                  <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--text-ghost)" }}>{p.label}</div>
                )}
                <GrafanaPanel url={p.url} label={p.label} height={h} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
