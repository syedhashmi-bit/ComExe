"use client";

import { useEffect, useRef, useState } from "react";
import { IconGrafana } from "@/app/components/icons";
import { usePollingInterval } from "@/app/hooks/usePolling";

interface ProbeResult {
  ok:     boolean;
  status: number;
  reason: "ok" | "auth" | "not_found" | "unreachable" | "no_url";
  hint?:  string;
}

function GrafanaPanel({ url, label, height, baseUrl, tokenSet }: { url: string; label?: string; height: number; baseUrl: string; tokenSet?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [probe,  setProbe]  = useState<ProbeResult | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  // When using server-side render, the <img> width should match the container
  // so we don't ship an oversized PNG. ResizeObserver keeps it in sync.
  useEffect(() => {
    if (!tokenSet || !containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [tokenSet]);

  // Server-side probe — iframes can't tell us if Grafana returned auth error
  // or a real panel, so we ask our own backend to fetch the URL and inspect
  // it. Skip when we're going to use the render proxy (it has its own check).
  useEffect(() => {
    if (tokenSet) return;
    let cancelled = false;
    fetch(`/api/grafana/test?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then((p: ProbeResult) => { if (!cancelled) setProbe(p); })
      .catch(() => { if (!cancelled) setProbe({ ok: false, status: 0, reason: "unreachable", hint: "Probe failed" }); });
    return () => { cancelled = true; };
  }, [url, tokenSet]);

  if (probe && !probe.ok) {
    return <GrafanaFallback height={height} probe={probe} baseUrl={baseUrl} panelUrl={url} />;
  }

  // Token path — server-side proxy returns a PNG, we render as <img>. Refresh
  // every 60s via cache-busting query param so the panel stays live.
  if (tokenSet) {
    return (
      <div ref={containerRef} style={{ position: "relative", height, borderRadius: 8, overflow: "hidden" }}>
        {!loaded && !renderError && (
          <div style={{
            position: "absolute", inset: 0, background: "var(--card-alt)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, color: "var(--text-ghost)",
          }}>Rendering{label ? ` ${label}` : " panel"}…</div>
        )}
        {renderError ? (
          <GrafanaFallback
            height={height}
            probe={{ ok: false, status: 502, reason: "unreachable", hint: renderError }}
            baseUrl={baseUrl}
            panelUrl={url}
          />
        ) : (
          <RefreshingImg url={url} width={width} height={height} onLoaded={() => setLoaded(true)} onError={setRenderError} />
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height }}>
      {!loaded && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 8,
          background: "var(--card-alt)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
        }}>
          <span className="text-xs" style={{ color: "var(--text-ghost)" }}>Loading{label ? ` ${label}` : " panel"}…</span>
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

// Cache-busting refresh every 60s. onError fires when the proxy returns a
// non-200 (renderer plugin missing, bad token, etc.) — we surface that via
// the GrafanaFallback path.
function RefreshingImg({ url, width, height, onLoaded, onError }: {
  url: string; width: number; height: number;
  onLoaded: () => void; onError: (msg: string) => void;
}) {
  const [tick, setTick] = useState(0);
  // Each tick re-requests /api/grafana/render, which drives a HEADLESS PANEL
  // RENDER on the Grafana host — by a wide margin the heaviest upstream call
  // this app makes (20s timeout). Leaving a tab open used to fire it every
  // 60s forever. skipImmediate: the <img> already loads once on mount.
  usePollingInterval(() => setTick(t => t + 1), 60_000, { skipImmediate: true });

  const src = `/api/grafana/render?url=${encodeURIComponent(url)}&width=${width}&height=${height}&t=${tick}`;
  return (
    <img
      src={src}
      width="100%"
      height={height}
      style={{ display: "block", width: "100%", height, objectFit: "contain" }}
      onLoad={onLoaded}
      onError={async () => {
        // Re-fetch to read the JSON error body
        try {
          const r = await fetch(src);
          if (!r.ok) {
            const body = await r.json().catch(() => null);
            // Accept both shapes: `message` is the standard used across the
            // API routes, `error` is kept for older cached clients.
            onError(body?.message ?? body?.error ?? `Render proxy returned HTTP ${r.status}`);
          }
        } catch (e) {
          onError((e as Error).message);
        }
      }}
    />
  );
}

function GrafanaFallback({ height, probe, baseUrl, panelUrl }: { height: number; probe: ProbeResult; baseUrl: string; panelUrl: string }) {
  const isAuth = probe.reason === "auth";
  const isNotFound = probe.reason === "not_found";
  const accent = isAuth ? "var(--warn)" : "var(--critical)";

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
        <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
          {isAuth ? "Grafana embed blocked by auth" : isNotFound ? "Panel not found" : "Grafana unreachable"}
        </span>
        <span className="text-xs ml-auto" style={{ color: "var(--text-ghost)" }}>HTTP {probe.status || "—"}</span>
      </div>

      {probe.hint && (
        <div className="text-xs" style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>{probe.hint}</div>
      )}

      {isAuth && (
        <>
          <div className="text-xs" style={{ color: "var(--text-dim)", lineHeight: 1.6 }}>
            Iframes can&apos;t carry your Grafana session cookies cross-origin, so embeds only work when Grafana&apos;s anonymous viewer is enabled or you proxy with a service account token. Pick one:
          </div>
          <details style={{ background: "var(--card-alt)", borderRadius: 6, padding: "6px 10px" }}>
            <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>1. Enable Grafana anonymous viewer (one env var)</summary>
            <div className="text-xs mt-2" style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>
              On the Grafana container, set:
              <pre style={{ fontFamily: "monospace", fontSize: 12, background: "var(--bg)", borderRadius: 4, padding: "6px 8px", marginTop: 4, overflowX: "auto" }}>{`GF_AUTH_ANONYMOUS_ENABLED=true
GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer
GF_SECURITY_ALLOW_EMBEDDING=true`}</pre>
              Restart Grafana, refresh this page. Safest option for LAN-only homelabs.
            </div>
          </details>
          <details style={{ background: "var(--card-alt)", borderRadius: 6, padding: "6px 10px" }}>
            <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>2. Use a service-account API token</summary>
            <div className="text-xs mt-2" style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>
              Grafana → Administration → Service accounts → Add → Viewer role → Add token. Then set <code style={{ fontFamily: "monospace" }}>GRAFANA_API_TOKEN</code> on the ComExe container, and ComExe renders the panel server-side as an image — no iframe cookies involved.
            </div>
          </details>
          <details style={{ background: "var(--card-alt)", borderRadius: 6, padding: "6px 10px" }}>
            <summary style={{ fontSize: 12, cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}>3. Hide the Grafana card</summary>
            <div className="text-xs mt-2" style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>
              Settings → Visible cards → uncheck Grafana.
            </div>
          </details>
        </>
      )}

      {isNotFound && (
        <div className="text-xs" style={{ color: "var(--text-dim)", lineHeight: 1.5 }}>
          Double-check <code style={{ fontFamily: "monospace" }}>GRAFANA_DASHBOARD_UID</code>, <code style={{ fontFamily: "monospace" }}>GRAFANA_PANEL_ID</code>, and <code style={{ fontFamily: "monospace" }}>GRAFANA_DASHBOARD_SLUG</code>. The UID is the random string in the dashboard URL after <code style={{ fontFamily: "monospace" }}>/d/</code>.
        </div>
      )}

      <a href={baseUrl} target="_blank" rel="noopener noreferrer"
        className="text-xs mt-auto"
        style={{ color: accent, textDecoration: "none", alignSelf: "flex-start" }}>
        Open Grafana ↗
      </a>
      <a href={panelUrl} target="_blank" rel="noopener noreferrer"
        className="text-xs"
        style={{ color: "var(--text-faint)", textDecoration: "none", alignSelf: "flex-start" }}>
        Try the panel URL directly ↗
      </a>
    </div>
  );
}

// Remembers "Hide" on the not-set-up hint, like Disk health's.
const HINT_KEY = "comexe:grafana-hint-hidden";

function readHintHidden(): boolean {
  try { return typeof window !== "undefined" && localStorage.getItem(HINT_KEY) === "1"; }
  catch { return false; }
}

// No panel configured: one slim line instead of a 220px box announcing an
// absence. The dashboard only mounts this once /api/config has loaded, so
// reading localStorage in the initializer can't cause a hydration mismatch.
function GrafanaHint() {
  const [hidden, setHidden] = useState(readHintHidden);
  if (hidden) return null;
  return (
    <div className="flex items-center gap-2" style={{
      border: "1px dashed var(--border)", borderRadius: 10, padding: "7px 14px",
      fontSize: 12, color: "var(--text-label)", minWidth: 0,
    }}>
      <span aria-hidden="true" className="shrink-0" style={{ display: "inline-flex" }}><IconGrafana /></span>
      <span className="shrink-0" style={{ color: "var(--text-secondary)", fontWeight: 600 }}>Grafana</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-ghost)" }}>
        not set up · add a dashboard panel in <a href="/setup" style={{ color: "var(--text-label)" }}>setup</a> to show it here
      </span>
      <button onClick={() => {
        setHidden(true);
        try { localStorage.setItem(HINT_KEY, "1"); } catch { /* private mode etc. */ }
      }} className="shrink-0" style={{
        marginLeft: "auto", fontSize: 12, color: "var(--text-label)", background: "none",
        border: "1px solid var(--border)", borderRadius: 5, padding: "2px 8px", cursor: "pointer",
      }}>Hide</button>
    </div>
  );
}

export function GrafanaCard({ baseUrl, panelUrl, panels, tokenSet }: {
  baseUrl: string;
  panelUrl: string | null;
  panels?: { panelId: string; label: string; size: "sm" | "md" | "lg"; url: string }[];
  tokenSet?: boolean;
}) {
  const allPanels = panels && panels.length > 0 ? panels : panelUrl ? [{ panelId: "default", label: "Panel", size: "lg" as const, url: panelUrl }] : [];
  if (allPanels.length === 0) return <GrafanaHint />;

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 10, padding: 16,
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" style={{ color: "var(--accent-grafana)", display: "inline-flex" }}><IconGrafana /></span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Grafana</span>
          <span className="text-xs" style={{ color: "var(--text-ghost)" }}>{allPanels.length} panel{allPanels.length !== 1 ? "s" : ""}</span>
        </div>
        <a href={baseUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs"
          style={{ color: "var(--text-faint)", textDecoration: "none", transition: "color 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--text)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-faint)")}>
          Open Grafana ↗
        </a>
      </div>

      {allPanels.length === 1 ? (
        <GrafanaPanel url={allPanels[0].url} label={allPanels[0].label} height={220} baseUrl={baseUrl} tokenSet={tokenSet} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          {allPanels.map((p, i) => {
            const colSpan = p.size === "lg" ? 3 : p.size === "md" ? 2 : 1;
            const h = p.size === "lg" ? 220 : p.size === "md" ? 180 : 150;
            return (
              <div key={p.panelId + i} style={{ gridColumn: `span ${colSpan}` }}>
                {allPanels.length > 1 && (
                  <div className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>{p.label}</div>
                )}
                <GrafanaPanel url={p.url} label={p.label} height={h} baseUrl={baseUrl} tokenSet={tokenSet} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
