"use client";

import { useState } from "react";
import type { ServiceResult, ClientConfig } from "@/app/lib/types";
import { SVC_PORTS } from "@/app/lib/constants";
import { cleanTitle, fmtEtaShort, fmtSmoothAgo } from "@/app/lib/formatters";
import { IconServices } from "@/app/components/icons";
import {
  animatedLine, HeroStat, GaugeBar, Skeleton, ServiceIcon,
} from "@/app/components/primitives";
import { ServiceDetailSheet } from "@/app/components/ServiceDetailSheet";

const SVC_COLORS: Record<string, string> = {
  radarr: "#f5c518", sonarr: "#35c5f4", bazarr: "#4a90d9",
  tautulli: "#e5a00d", qbittorrent: "#2196f3", overseerr: "#e5a00d",
  pihole: "#f60d1a", prowlarr: "#ff8c00", nginx: "#2ecc71",
  uptimekuma: "#5cdd8b",
};

const SVC_ICONS: Record<string, string> = {
  radarr:      "/icons/radarr.png",
  sonarr:      "/icons/sonarr.png",
  bazarr:      "/icons/bazarr.png",
  tautulli:    "/icons/tautulli.png",
  qbittorrent: "/icons/qbittorrent.png",
  overseerr:   "/icons/overseerr.png",
  nginx:       "/icons/nginx.png",
  pihole:      "/icons/pihole.png",
  prowlarr:    "/icons/prowlarr.png",
  uptimekuma:  "/icons/uptimekuma.png",
};

function buildSvcUrls(ip: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SVC_PORTS).map(([name, port]) => [name, `http://${ip}:${port}`])
  );
}

// Display names with official brand casing — without an entry the card falls
// back to the raw lowercase route name.
const SVC_LABELS: Record<string, string> = {
  radarr:      "Radarr",
  sonarr:      "Sonarr",
  bazarr:      "Bazarr",
  tautulli:    "Tautulli",
  qbittorrent: "qBittorrent",
  overseerr:   "Overseerr",
  prowlarr:    "Prowlarr",
  pihole:      "Pi-hole",
  nginx:       "Nginx Proxy",
  uptimekuma:  "Uptime Kuma",
};

const SVC_CATEGORIES: { id: string; label: string; accent: string; services: string[] }[] = [
  { id: "media", label: "media stack",   accent: "var(--warn)", services: ["radarr", "sonarr", "bazarr", "tautulli", "qbittorrent", "overseerr", "prowlarr"] },
  { id: "infra", label: "infrastructure", accent: "var(--brand)", services: ["pihole", "nginx", "uptimekuma"] },
];

export interface ServicesPanelProps {
  services: ServiceResult[] | null;
  servicesLoading: boolean;
  servicesUpdatedAt: number | null;
  serviceFilter: string;
  setServiceFilter: (v: string) => void;
  serviceFilterRef: React.RefObject<HTMLInputElement | null>;
  clientConfig: ClientConfig | null;
  setLogsContainer: (name: string | null) => void;
  restartingSvc: string | null;
  restartService: (name: string) => void;
}

export function ServicesPanel({
  services, servicesLoading, servicesUpdatedAt,
  serviceFilter, setServiceFilter, serviceFilterRef,
  clientConfig, setLogsContainer, restartingSvc, restartService,
}: ServicesPanelProps) {
  // Track which service card is expanded into the right-side detail sheet.
  // Null = no card expanded. Stored by name (matches ServiceResult.name).
  const [detailServiceName, setDetailServiceName] = useState<string | null>(null);
  const detailService = detailServiceName
    ? services?.find(s => s.name === detailServiceName) ?? null
    : null;

  return (
    <div className="flex flex-col gap-4" style={{ background: "var(--surface-dim)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 20 }}>
      <div className="flex items-center gap-3 flex-wrap">
        <span style={{ color: "var(--accent-speedtest)", opacity: 0.8 }}><IconServices /></span>
        <span className="text-[10px] uppercase" style={{ color: "var(--text-label)", letterSpacing: "0.15em" }}>services</span>
        {services && (() => {
          const configured = services.filter(s => s.configured !== false);
          if (configured.length === 0) return null;
          return (
            <span style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "var(--ok)", fontWeight: 600 }}>
              {configured.filter(s => s.up).length} / {configured.length} online
            </span>
          );
        })()}
        <div className="ml-auto relative" style={{ width: 160 }}>
          <input
            ref={serviceFilterRef}
            type="text"
            placeholder="filter (/ to focus)"
            value={serviceFilter}
            onChange={e => setServiceFilter(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") { setServiceFilter(""); e.currentTarget.blur(); } }}
            className="text-[10px] w-full"
            style={{
              background: "var(--card-alt)", border: "1px solid var(--border)", borderRadius: 6,
              padding: serviceFilter ? "3px 22px 3px 8px" : "3px 8px",
              color: "var(--text)", outline: "none", fontFamily: "monospace",
            }}
          />
          {serviceFilter && (
            <button
              onClick={() => { setServiceFilter(""); serviceFilterRef.current?.focus(); }}
              title="Clear filter (Esc)"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center"
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--text-ghost)", padding: 2, lineHeight: 1,
                fontSize: 14, width: 16, height: 16, borderRadius: 3,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-ghost)"; }}
            >&times;</button>
          )}
        </div>
        {servicesUpdatedAt != null && (
          <span title={`Last update: ${new Date(servicesUpdatedAt).toLocaleTimeString()}`}
            className="text-[9px]" style={{ color: "var(--text-ghost)" }}>
            updated {fmtSmoothAgo(servicesUpdatedAt)}
          </span>
        )}
      </div>
      {servicesLoading ? <Skeleton /> : !services ? (
        <span style={{ fontSize: 12, color: "var(--text-label)" }}>unavailable</span>
      ) : (
        <div className="flex flex-col gap-5">
          {SVC_CATEGORIES.map(cat => {
            const filter = serviceFilter.trim().toLowerCase();
            const catCards = cat.services
              .map(svcName => services.find(s => s.name === svcName))
              .filter((s): s is NonNullable<typeof s> => Boolean(s))
              .filter(s => s.configured !== false)
              .filter(s => !filter || s.name.toLowerCase().includes(filter));
            if (catCards.length === 0) return null;
            const upCount = catCards.filter(s => s.up).length;
            const allUp = upCount === catCards.length;
            return (
              <div key={cat.id} className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: cat.accent, boxShadow: `0 0 6px ${cat.accent}88` }} />
                  <span className="text-[10px] uppercase" style={{ color: "var(--text-dim)", letterSpacing: "0.22em", fontWeight: 700 }}>
                    {cat.label}
                  </span>
                  <span style={{ flex: 1, height: 1, background: `linear-gradient(to right, ${cat.accent}33, transparent 70%)` }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: allUp ? "#10b981" : "rgba(255,255,255,0.45)", fontVariantNumeric: "tabular-nums" }}>
                    {upCount}/{catCards.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {[...catCards].sort((a, b) => {
                    const tier = (s: ServiceResult) => {
                      if (!s.up) return 0;
                      if ((s.health?.error ?? 0) > 0) return 1;
                      if ((s.health?.warning ?? 0) > 0) return 2;
                      const hasQ = (s.queueItems?.length ?? 0) > 0 || s.queueItem;
                      const hasS = (s.streams?.length ?? 0) > 0;
                      if (hasQ || hasS) return 3;
                      return 4;
                    };
                    return tier(a) - tier(b);
                  }).map(({ name, up, lines, pct: svcPct, downCount, queueItems, streams: svcStreams, health, stale, staleSince, authError }, cardIdx) => {
                    const color = SVC_COLORS[name] ?? "#666";
                    const icon  = SVC_ICONS[name]  ?? "";
                    const label = SVC_LABELS[name]  ?? name;
                    const svcUrls = buildSvcUrls(clientConfig?.truenasIp ?? "192.168.88.196");
                    const resolvedUrl = clientConfig?.serviceUrls?.[name] ?? svcUrls[name];
                    const stripeColor = up ? color : "rgba(255,255,255,0.12)";
                    return (
                      <div key={name}
                        className="flex flex-col cursor-pointer relative overflow-hidden"
                        onClick={() => resolvedUrl && window.open(resolvedUrl, "_blank")}
                        onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                        onMouseUp={e => (e.currentTarget.style.transform = "translateY(-3px)")}
                        style={{
                          background: up
                            ? `radial-gradient(ellipse at top, ${color}1a 0%, transparent 55%), rgba(255,255,255,0.03)`
                            : "rgba(255,255,255,0.03)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 12, padding: 0, minHeight: 140,
                          transition: "transform 0.15s, border-color 0.15s, box-shadow 0.2s, opacity 0.3s",
                          // Stagger mount: each card fades+slides in 30ms after the previous.
                          animation: `serviceCardIn 0.35s ease-out both`,
                          animationDelay: `${cardIdx * 35}ms`,
                          // Dim the card body slightly when serving cached (stale) data,
                          // so a glance tells you the data isn't live. The pill says STALE,
                          // but the dimming reinforces it at the card level.
                          opacity: stale ? 0.78 : 1,
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.transform = "translateY(-3px)";
                          e.currentTarget.style.borderColor = up ? `${color}55` : "rgba(255,255,255,0.18)";
                          if (up) e.currentTarget.style.boxShadow = `0 10px 30px ${color}33, 0 0 0 1px ${color}33 inset`;
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.transform = "translateY(0)";
                          e.currentTarget.style.borderColor = "var(--border-subtle)";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      >
                        <div style={{
                          height: 3,
                          background: `linear-gradient(90deg, ${stripeColor} 0%, ${stripeColor}88 60%, ${stripeColor}33 100%)`,
                          boxShadow: up ? `0 0 8px ${color}77` : "none",
                        }} />
                        <div className="flex flex-col gap-2" style={{ padding: "13px 14px 14px" }}>
                          <div className="flex items-center justify-between gap-2">
                            <ServiceIcon src={icon} label={label} color={color} />
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={e => { e.stopPropagation(); setDetailServiceName(name); }}
                                title="Show details"
                                style={{
                                  background: "var(--card-alt)", border: "1px solid var(--border)",
                                  borderRadius: 4, padding: "1px 5px", fontSize: 9,
                                  color: "var(--text-dim)", cursor: "pointer", lineHeight: 1.2,
                                }}
                                onMouseEnter={e => { e.currentTarget.style.color = color; e.currentTarget.style.borderColor = `${color}66`; }}
                                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.borderColor = "var(--border)"; }}
                              >&rsaquo;</button>
                              {clientConfig?.dockerEnabled && (
                                <>
                                  <button
                                    onClick={e => { e.stopPropagation(); setLogsContainer(name); }}
                                    title="View container logs"
                                    style={{ background: "var(--card-alt)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px", fontSize: 9, color: "var(--text-dim)", cursor: "pointer" }}
                                  >logs</button>
                                  <button
                                    onClick={e => { e.stopPropagation(); if (confirm(`Restart ${name}?`)) restartService(name); }}
                                    disabled={restartingSvc === name}
                                    title="Restart container"
                                    style={{ background: "var(--card-alt)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px", fontSize: 9, color: restartingSvc === name ? "var(--text-faint)" : "var(--text-dim)", cursor: restartingSvc === name ? "wait" : "pointer" }}
                                  >{restartingSvc === name ? "…" : "↻"}</button>
                                </>
                              )}
                              {up && health && (health.error > 0 || health.warning > 0) && (() => {
                                const isError = health.error > 0;
                                const accent  = isError ? "#ef4444" : "#f59e0b";
                                const total   = health.error + health.warning;
                                const pillLabel = isError
                                  ? `${total} ${total === 1 ? "err" : "errs"}`
                                  : `${total} ${total === 1 ? "warn" : "warns"}`;
                                // Build a multi-line tooltip from the messages (server caps at 5).
                                // Each message is prefixed with a • bullet for readability.
                                const tooltip = health.messages && health.messages.length > 0
                                  ? health.messages.map(m => `• ${m}`).join("\n")
                                  : `${total} health ${isError ? "error" : "warning"}${total === 1 ? "" : "s"} reported by ${name} — open the service to inspect.`;
                                return (
                                  <span
                                    title={tooltip}
                                    onClick={e => { e.stopPropagation(); }}
                                    style={{
                                      background: `${accent}1a`, border: `1px solid ${accent}55`, color: accent,
                                      borderRadius: 4, padding: "1px 5px", fontSize: 9, fontWeight: 700,
                                      textTransform: "uppercase", letterSpacing: "0.05em", fontVariantNumeric: "tabular-nums",
                                      cursor: "help",
                                    }}>{pillLabel}</span>
                                );
                              })()}
                              {stale && (
                                <span title={staleSince ? `Last update ${Math.round((Date.now() - staleSince) / 1000)}s ago` : "Cached"}
                                  style={{
                                    background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)",
                                    color: "#f59e0b", borderRadius: 4, padding: "1px 5px",
                                    fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                                  }}>STALE</span>
                              )}
                              {authError && (
                                <span title="Service is up but the API key was rejected (HTTP 401/403). Update the env var in update-dashboard.sh and redeploy."
                                  style={{
                                    background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)",
                                    color: "#ef4444", borderRadius: 4, padding: "1px 5px",
                                    fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                                  }}>AUTH</span>
                              )}
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{
                                background: stale ? "#f59e0b" : up ? "#10b981" : "#ef4444",
                                boxShadow: stale ? "0 0 6px #f59e0baa" : up ? "0 0 6px #10b981aa" : "0 0 4px #ef444455",
                                animation: up && !stale ? "pulseDot 2s ease-in-out infinite" : "none",
                              }} />
                            </div>
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 700, color: up ? "#ffffff" : "rgba(255,255,255,0.3)", letterSpacing: "0.01em" }}>{label}</span>
                          {(() => {
                            // "No real data" = service is up but we have either no
                            // lines, or just a sentinel dash. Render a clearer
                            // placeholder + a "Open service" link instead of just
                            // showing a bare em-dash in the hero slot.
                            const noRealData = up && !authError && (
                              lines.length === 0 ||
                              (lines.length === 1 && (lines[0] === "—" || lines[0] === "loading…"))
                            );
                            if (noRealData) {
                              const isLoading = lines[0] === "loading…";
                              return (
                                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                                  <span style={{ fontSize: 11, color: "var(--text-label)", fontStyle: isLoading ? "italic" : "normal" }}>
                                    {isLoading ? "collecting data…" : "no data"}
                                  </span>
                                  {!isLoading && (
                                    <span style={{ fontSize: 9, color: "var(--text-ghost)", lineHeight: 1.4 }}>
                                      Service is reachable but the dashboard couldn&apos;t fetch detail.
                                      {resolvedUrl && <> Try opening <code style={{ fontSize: 8, color: "var(--text-dim)" }}>{resolvedUrl.replace(/^https?:\/\//, "")}</code> directly.</>}
                                    </span>
                                  )}
                                </div>
                              );
                            }
                            return (<>
                              {up && lines[0] && <HeroStat line={lines[0]} keyPrefix={`${name}-h`} />}
                              {up && lines.slice(1).map((line, i) => (
                                <span key={i} style={{
                                  color: name === "uptimekuma"
                                    ? ((downCount ?? 0) > 0 ? "#ef4444" : "#10b981")
                                    : name === "qbittorrent" && i === 0 ? "#06b6d4" : "rgba(255,255,255,0.5)",
                                  fontSize: 11, lineHeight: 1.5, fontVariantNumeric: "tabular-nums",
                                }}>{animatedLine(line, `${name}-${i + 1}`)}</span>
                              ))}
                            </>);
                          })()}
                          {!up && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 10, color: "#ef4444" }}>offline</span>
                              {resolvedUrl && (
                                <span style={{ fontSize: 9, color: "var(--text-ghost)", lineHeight: 1.4 }}>
                                  Can&apos;t reach <code style={{ fontSize: 8, color: "var(--text-dim)" }}>{resolvedUrl.replace(/^https?:\/\//, "")}</code> — is the container running?
                                </span>
                              )}
                            </div>
                          )}
                          {up && authError && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 10, color: "#ef4444" }}>API key rejected</span>
                              <span style={{ fontSize: 9, color: "var(--text-ghost)", lineHeight: 1.4 }}>
                                Service is reachable but returned <code style={{ fontSize: 8, color: "var(--text-dim)" }}>401</code>. Check the env var on TrueNAS.
                              </span>
                            </div>
                          )}
                          {name === "radarr" && svcPct != null && up && (
                            <GaugeBar percent={svcPct} color={svcPct > 90 ? "#10b981" : svcPct > 70 ? "#f59e0b" : "#ef4444"} thin />
                          )}
                          {(name === "radarr" || name === "sonarr" || name === "qbittorrent") && up && (queueItems?.length ?? 0) > 0 && (
                            <div className="flex flex-col gap-1.5 mt-0.5">
                              {queueItems!.slice(0, 3).map((q, qi) => {
                                const c = name === "radarr" ? "#f59e0b" : name === "sonarr" ? "#3b82f6" : "#06b6d4";
                                return (
                                  <div key={qi} className="flex flex-col gap-1">
                                    <div className="flex items-center gap-1.5">
                                      <span title={q.title} style={{ fontSize: 10, fontWeight: 500, color: c, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>↓ {cleanTitle(q.title)}</span>
                                      {fmtEtaShort(q.etaSec) && (
                                        <span style={{ fontSize: 9, color: "var(--text-label)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmtEtaShort(q.etaSec)}</span>
                                      )}
                                    </div>
                                    <GaugeBar percent={q.pct} color={c} thin />
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {name === "tautulli" && svcStreams && svcStreams.length > 0 && up && (
                            <div className="flex flex-col gap-2 mt-0.5">
                              {svcStreams.slice(0, 3).map((st, si) => (
                                <div key={si} className="flex flex-col gap-1">
                                  <span title={`${st.title}${st.user ? ` — ${st.user}` : ""}${st.posStr ? ` (${st.posStr})` : ""}`} style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.title}</span>
                                  <div style={{ height: 3, background: "var(--border-subtle)", borderRadius: 2 }}>
                                    <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(100, st.progress)}%`, background: "#8b5cf6", transition: "width 0.6s ease-out" }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* Every category returns null when the filter matches nothing — say
              so instead of collapsing to an empty section. */}
          {serviceFilter.trim() !== "" &&
            !services.some(s => s.configured !== false && s.name.toLowerCase().includes(serviceFilter.trim().toLowerCase())) && (
            <span style={{ fontSize: 11, color: "var(--text-ghost)", padding: "8px 2px" }}>
              No services match &ldquo;{serviceFilter.trim()}&rdquo; — Esc to clear
            </span>
          )}
        </div>
      )}

      {/* Right-side detail sheet for the currently-expanded service card. */}
      {detailService && (() => {
        const svcUrls = buildSvcUrls(clientConfig?.truenasIp ?? "192.168.88.196");
        const resolvedUrl = clientConfig?.serviceUrls?.[detailService.name] ?? svcUrls[detailService.name];
        return (
          <ServiceDetailSheet
            service={detailService}
            resolvedUrl={resolvedUrl}
            color={SVC_COLORS[detailService.name] ?? "#666"}
            iconSrc={SVC_ICONS[detailService.name]}
            label={SVC_LABELS[detailService.name] ?? detailService.name}
            onClose={() => setDetailServiceName(null)}
            onViewLogs={(n) => { setDetailServiceName(null); setLogsContainer(n); }}
            onRestart={(n) => { restartService(n); }}
            dockerEnabled={clientConfig?.dockerEnabled}
          />
        );
      })()}
    </div>
  );
}
