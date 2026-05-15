"use client";

import { useEffect, useState } from "react";
import { IconGrafana } from "@/app/components/icons";

interface ProbeResult {
  ok:     boolean;
  status: number;
  reason: "ok" | "auth" | "not_found" | "unreachable" | "no_url";
  hint?:  string;
}

function GrafanaPanel({ url, label, height, baseUrl }: { url: string; label?: string; height: number; baseUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  const [probe,  setProbe]  = useState<ProbeResult | null>(null);

  // Server-side probe — iframes can't tell us if Grafana returned auth error
  // or a real panel, so we ask our own backend to fetch the URL and inspect it.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/grafana/test?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then((p: ProbeResult) => { if (!cancelled) setProbe(p); })
      .catch(() => { if (!cancelled) setProbe({ ok: false, status: 0, reason: "unreachable", hint: "Probe failed" }); });
    return () => { cancelled = true; };
  }, [url]);

  if (probe && !probe.ok) {
    return <GrafanaFallback height={height} probe={probe} baseUrl={baseUrl} panelUrl={url} />;
  }

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

function GrafanaFallback({ height, probe, baseUrl, panelUrl }: { height: number; probe: ProbeResult; baseUrl: string; panelUrl: string }) {
  const isAuth = probe.reason === "auth";
  const isNotFound = probe.reason === "not_found";
  const accent = isAuth ? "var(--warning)" : "var(--critical)";

  return (
    <div style={{
      height, borderRadius: 8,
      background: "var(--surface-dim)",
      border: `1px solid ${accent}`,
      padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 8,
      overflow: "auto",
    }}>
      <div className="flex items-center gap-2">
        <span style={{ width: 8, height: 8, borderRadius: 4, background: accent, flexShrink: 0 }} />
        <span className="text-[11px] font-semibold" style={{ color: "var(--text)" }}>
          {isAuth ? "Grafana embed blocked by auth" : isNotFound ? "Panel not found" : "Grafana unreachable"}
        </span>
        <span className="text-[10px] ml-auto" style={{ color: "var(--text-ghost)" }}>HTTP {probe.status || "—"}</span>
      </div>

      {probe.hint && (
        <div className="text-[10px]" style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>{probe.hint}</div>
      )}

      {isAuth && (
        <>
          <div className="text-[10px]" style={{ color: "var(--text-dim)", lineHeight: 1.6 }}>
            Iframes can&apos;t carry your Grafana session cookies cross-origin, so embeds only work when Grafana&apos;s anonymous viewer is enabled or you proxy with a service account token. Pick one:
          </div>
          <details style={{ background: "var(--card-alt)", borderRadius: 6, padding: "6px 10px" }}>
            <summary style={{ fontSize: 10, cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>1. Enable Grafana anonymous viewer (one env var)</summary>
            <div className="text-[10px] mt-2" style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>
              On the Grafana container, set:
              <pre style={{ fontFamily: "monospace", fontSize: 9, background: "var(--bg)", borderRadius: 4, padding: "6px 8px", marginTop: 4, overflowX: "auto" }}>{`GF_AUTH_ANONYMOUS_ENABLED=true
GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer
GF_SECURITY_ALLOW_EMBEDDING=true`}</pre>
              Restart Grafana, refresh this page. Safest option for LAN-only homelabs.
            </div>
          </details>
          <details style={{ background: "var(--card-alt)", borderRadius: 6, padding: "6px 10px" }}>
            <summary style={{ fontSize: 10, cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>2. Use a service-account API token</summary>
            <div className="text-[10px] mt-2" style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>
              Grafana → Administration → Service accounts → Add → Viewer role → Add token. Then set <code style={{ fontFamily: "monospace" }}>GRAFANA_API_TOKEN</code> on the ComExe container. Coming in a future release: server-side <code style={{ fontFamily: "monospace" }}>/render</code> proxy that uses this.
            </div>
          </details>
          <details style={{ background: "var(--card-alt)", borderRadius: 6, padding: "6px 10px" }}>
            <summary style={{ fontSize: 10, cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>3. Hide the Grafana card</summary>
            <div className="text-[10px] mt-2" style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>
              Settings → Visible cards → uncheck Grafana.
            </div>
          </details>
        </>
      )}

      {isNotFound && (
        <div className="text-[10px]" style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>
          Double-check <code style={{ fontFamily: "monospace" }}>GRAFANA_DASHBOARD_UID</code>, <code style={{ fontFamily: "monospace" }}>GRAFANA_PANEL_ID</code>, and <code style={{ fontFamily: "monospace" }}>GRAFANA_DASHBOARD_SLUG</code>. The UID is the random string in the dashboard URL after <code style={{ fontFamily: "monospace" }}>/d/</code>.
        </div>
      )}

      <a href={baseUrl} target="_blank" rel="noopener noreferrer"
        className="text-[10px] mt-auto"
        style={{ color: accent, textDecoration: "none", alignSelf: "flex-start" }}>
        open Grafana ↗
      </a>
      <a href={panelUrl} target="_blank" rel="noopener noreferrer"
        className="text-[10px]"
        style={{ color: "var(--text-faint)", textDecoration: "none", alignSelf: "flex-start" }}>
        try panel URL directly ↗
      </a>
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
        <GrafanaPanel url={allPanels[0].url} label={allPanels[0].label} height={220} baseUrl={baseUrl} />
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
                <GrafanaPanel url={p.url} label={p.label} height={h} baseUrl={baseUrl} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
