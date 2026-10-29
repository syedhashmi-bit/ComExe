"use client";

import { useState } from "react";
import type { ServiceResult, ClientConfig } from "@/app/lib/types";
import { SVC_COLORS, SVC_ICONS, SVC_LABELS, SVC_PORTS } from "@/app/lib/constants";
import { cleanTitle, fmtEtaShort, fmtSmoothAgo } from "@/app/lib/formatters";
import { animatedLine, GaugeBar, Skeleton } from "@/app/components/primitives";
import { ServiceDetailSheet } from "@/app/components/ServiceDetailSheet";
import { serviceUptime, fmtUptimePct, type IncidentFeed } from "@/app/components/IncidentStrip";

// ── Services panel ──────────────────────────────────────────────────────────
// A compact grouped list: one row per service with its status in words, the
// app's own icon, its key number and a line of detail. Colour appears only in
// the status column. (It used to be a grid of brand-coloured cards with glow
// stripes, which made every service look like it was shouting.)

function buildSvcUrls(ip: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SVC_PORTS).map(([name, port]) => [name, `http://${ip}:${port}`])
  );
}

const SVC_CATEGORIES: { id: string; label: string; services: string[] }[] = [
  { id: "media", label: "Media",          services: ["radarr", "sonarr", "bazarr", "tautulli", "qbittorrent", "overseerr", "prowlarr"] },
  { id: "infra", label: "Infrastructure", services: ["pihole", "nginx", "uptimekuma"] },
];

// Problems first, then busy services, then idle ones; route order within a tier.
function tier(s: ServiceResult): number {
  if (!s.up || s.authError) return 0;
  if ((s.health?.error ?? 0) > 0) return 1;
  if ((s.health?.warning ?? 0) > 0 || s.stale) return 2;
  if ((s.queueItems?.length ?? 0) > 0 || s.queueItem || (s.streams?.length ?? 0) > 0) return 3;
  return 4;
}

function healthTitle(s: ServiceResult, kind: "error" | "warning"): string {
  const n = s.health?.[kind] ?? 0;
  const msgs = s.health?.messages ?? [];
  return msgs.length > 0
    ? msgs.map(m => `• ${m}`).join("\n")
    : `${n} health ${kind}${n === 1 ? "" : "s"} reported by ${SVC_LABELS[s.name] ?? s.name}. Open it to inspect.`;
}

function rowStatus(s: ServiceResult): { word: string; color: string; title?: string } {
  if (!s.up) return { word: "Down", color: "var(--critical)" };
  if (s.authError) return { word: "Auth failed", color: "var(--critical)", title: "Reachable, but the credentials were rejected (401/403). Fix them in Setup." };
  if ((s.health?.error ?? 0) > 0) return { word: "Health error", color: "var(--critical)", title: healthTitle(s, "error") };
  if ((s.health?.warning ?? 0) > 0) return { word: "Warning", color: "var(--warn)", title: healthTitle(s, "warning") };
  if (s.stale) return { word: "Stale", color: "var(--warn)", title: s.staleSince ? `Showing data from ${fmtSmoothAgo(s.staleSince)}` : "Showing cached data" };
  if (s.name === "uptimekuma" && (s.downCount ?? 0) > 0) return { word: `${s.downCount} down`, color: "var(--warn)" };
  if (s.lines[0] === "loading…") return { word: "Loading", color: "var(--text-ghost)" };
  return { word: "Up", color: "var(--ok)" };
}

// The app's own (full-colour) icon at row size; a letter tile if it fails to load.
function RowIcon({ src, label }: { src?: string; label: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <span aria-hidden="true" className="inline-flex items-center justify-center shrink-0"
        style={{ width: 20, height: 20, borderRadius: 5, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
        {label[0]?.toUpperCase()}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- 20px static icon from /public, no optimisation needed
  return <img src={src} alt="" width={20} height={20} className="shrink-0" style={{ width: 20, height: 20, borderRadius: 4, objectFit: "contain" }} onError={() => setErr(true)} />;
}

const actionBtn: React.CSSProperties = {
  background: "transparent", border: "1px solid var(--border)", borderRadius: 6,
  minWidth: 28, height: 26, padding: "0 7px", fontSize: 12, lineHeight: 1,
  color: "var(--text-muted)", cursor: "pointer",
};

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
  incidents?: IncidentFeed | null;   // the collector's log, for each row's 24 h strip
}

export function ServicesPanel({
  services, servicesLoading, servicesUpdatedAt,
  serviceFilter, setServiceFilter, serviceFilterRef,
  clientConfig, setLogsContainer, restartingSvc, restartService, incidents,
}: ServicesPanelProps) {
  // Which service's detail sheet is open, by name (matches ServiceResult.name).
  const [detailServiceName, setDetailServiceName] = useState<string | null>(null);
  const detailService = detailServiceName
    ? services?.find(s => s.name === detailServiceName) ?? null
    : null;

  const svcUrls = buildSvcUrls(clientConfig?.truenasIp ?? "192.168.88.196");
  const urlFor = (name: string) => clientConfig?.serviceUrls?.[name] ?? svcUrls[name];
  const filter = serviceFilter.trim().toLowerCase();

  const configured = services?.filter(s => s.configured !== false) ?? [];
  const upCount = configured.filter(s => s.up).length;
  const problemCount = configured.filter(s => tier(s) <= 2).length;

  return (
    <section aria-labelledby="services-h" className="flex flex-col"
      style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px 8px" }}>
      <div className="flex flex-wrap items-center" style={{ columnGap: 12, rowGap: 8, paddingBottom: 10 }}>
        <h2 id="services-h" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Services</h2>
        {configured.length > 0 && (
          <span style={{ fontSize: 12, color: "var(--text-label)", fontVariantNumeric: "tabular-nums" }}>
            {upCount} of {configured.length} up{problemCount > 0 ? ` · ${problemCount} need${problemCount === 1 ? "s" : ""} attention` : ""}
          </span>
        )}
        <label className="relative" style={{ marginLeft: "auto", width: 180 }}>
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Filter services</span>
          <input
            ref={serviceFilterRef}
            type="text"
            placeholder="Filter  (/)"
            value={serviceFilter}
            onChange={e => setServiceFilter(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") { setServiceFilter(""); e.currentTarget.blur(); } }}
            className="w-full"
            style={{
              background: "var(--surface-dim)", border: "1px solid var(--border)", borderRadius: 6,
              height: 28, padding: serviceFilter ? "0 24px 0 8px" : "0 8px", fontSize: 12,
              color: "var(--text)", outline: "none",
            }}
          />
          {serviceFilter && (
            <button
              onClick={() => { setServiceFilter(""); serviceFilterRef.current?.focus(); }}
              title="Clear filter (Esc)"
              aria-label="Clear service filter"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-ghost)", fontSize: 14, width: 18, height: 18 }}
            >&times;</button>
          )}
        </label>
        {servicesUpdatedAt != null && (
          <span title={`Last update: ${new Date(servicesUpdatedAt).toLocaleTimeString()}`}
            style={{ fontSize: 12, color: "var(--text-ghost)" }}>
            updated {fmtSmoothAgo(servicesUpdatedAt)}
          </span>
        )}
      </div>

      {servicesLoading ? <Skeleton /> : !services ? (
        <span style={{ fontSize: 12, color: "var(--text-label)", padding: "8px 0" }}>Unavailable</span>
      ) : (
        <>
          {SVC_CATEGORIES.map(cat => {
            const rows = cat.services
              .map(n => services.find(s => s.name === n))
              .filter((s): s is ServiceResult => Boolean(s))
              .filter(s => s.configured !== false)
              .filter(s => !filter || s.name.toLowerCase().includes(filter) || (SVC_LABELS[s.name] ?? "").toLowerCase().includes(filter));
            if (rows.length === 0) return null;
            const catUp = rows.filter(s => s.up).length;
            return (
              <div key={cat.id}>
                <div className="flex items-baseline justify-between"
                  style={{ fontSize: 12, color: "var(--text-label)", padding: "12px 0 6px", borderTop: "1px solid var(--border-subtle)" }}>
                  <span>{cat.label}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{catUp}/{rows.length}</span>
                </div>
                {[...rows].sort((a, b) => tier(a) - tier(b)).map(s => {
                  const label = SVC_LABELS[s.name] ?? s.name;
                  const url = urlFor(s.name);
                  const host = url?.replace(/^https?:\/\//, "");
                  const st = rowStatus(s);
                  const noRealData = s.up && !s.authError && (s.lines.length === 0 || (s.lines.length === 1 && (s.lines[0] === "—" || s.lines[0] === "loading…")));
                  const primary = s.up && !s.authError && !noRealData ? s.lines[0] : "";
                  const secondary =
                    !s.up        ? `Can't reach ${host ?? "it"}. Is the container running?`
                    : s.authError ? "Credentials rejected. Fix them in Setup."
                    : noRealData  ? (s.lines[0] === "loading…" ? "Collecting data…" : `Reachable, but no detail came back. Try opening ${host ?? "it"}.`)
                    : s.lines.slice(1).join(" · ");
                  const queue = (s.name === "radarr" || s.name === "sonarr" || s.name === "qbittorrent") && s.up ? (s.queueItems ?? []).slice(0, 3) : [];
                  const streams = s.name === "tautulli" && s.up ? (s.streams ?? []).slice(0, 3) : [];
                  const uptime = incidents?.enabled && incidents.now != null
                    ? serviceUptime(incidents.incidents ?? [], s.name, incidents.now, incidents.since ?? incidents.now)
                    : null;

                  return (
                    <div key={s.name} style={{ borderTop: "1px solid var(--border-dim)", padding: "9px 0" }}>
                      <div className="flex flex-wrap items-center" style={{ columnGap: 16, rowGap: 4 }}>
                        <span title={st.title} className="flex items-center shrink-0"
                          style={{ gap: 8, width: 104, fontSize: 12, fontWeight: 500, color: st.color, cursor: st.title ? "help" : undefined }}>
                          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: st.color, flexShrink: 0 }} />
                          {st.word}
                        </span>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center shrink-0"
                          style={{ gap: 10, width: 150, fontSize: 14, fontWeight: 500, color: s.up ? "var(--text)" : "var(--text-label)", textDecoration: "none" }}
                          onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
                          onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}>
                          <RowIcon src={SVC_ICONS[s.name]} label={label} />
                          <span className="truncate">{label}</span>
                        </a>
                        {primary && (
                          <span className="font-mono shrink-0" style={{ minWidth: 150, fontSize: 13, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                            {animatedLine(primary, `${s.name}-p`)}
                          </span>
                        )}
                        {secondary && (
                          <span title={secondary} style={{ flex: "1 1 180px", minWidth: 0, fontSize: 12, color: "var(--text-label)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {secondary}
                          </span>
                        )}
                        <span className="flex items-center shrink-0" style={{ gap: 6, marginLeft: "auto" }}>
                          {uptime && (
                            <span className="flex items-center" style={{ gap: 8, marginRight: 4 }}
                              title={uptime.pct != null ? `Last 24 hours: up ${fmtUptimePct(uptime.pct)} of the time` : "Last 24 hours"}>
                              <span role="img" aria-label={`${label}, last 24 hours${uptime.pct != null ? `: up ${fmtUptimePct(uptime.pct)}` : ""}`}
                                className="flex" style={{ gap: 1, width: 96, height: 12 }}>
                                {uptime.cells.map((l, ci) => (
                                  <span key={ci} style={{ flex: 1, borderRadius: 1, background: l === "critical" ? "var(--critical)" : l === "warning" ? "var(--warn)" : "var(--gauge-track)" }} />
                                ))}
                              </span>
                              {uptime.pct != null && (
                                <span className="font-mono" style={{ fontSize: 12, color: "var(--text-faint)", minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                  {fmtUptimePct(uptime.pct)}
                                </span>
                              )}
                            </span>
                          )}
                          {clientConfig?.dockerEnabled && (
                            <>
                              <button onClick={() => setLogsContainer(s.name)} title="View container logs"
                                aria-label={`View container logs for ${label}`} style={actionBtn}>Logs</button>
                              <button onClick={() => { if (confirm(`Restart ${label}?`)) restartService(s.name); }}
                                disabled={restartingSvc === s.name} title="Restart container" aria-label={`Restart ${label}`}
                                style={{ ...actionBtn, cursor: restartingSvc === s.name ? "wait" : "pointer" }}>
                                {restartingSvc === s.name ? "…" : "↻"}
                              </button>
                            </>
                          )}
                          <button onClick={() => setDetailServiceName(s.name)} title="Show details"
                            aria-label={`Show details for ${label}`} style={actionBtn}>&rsaquo;</button>
                        </span>
                      </div>

                      {(queue.length > 0 || streams.length > 0) && (
                        // Indented under the name column on wide screens; on a phone that
                        // indent would leave titles a few characters wide.
                        <div className="flex flex-col" style={{ gap: 6, margin: "8px 0 2px min(120px, 10vw)", maxWidth: 520 }}>
                          {queue.map((q, qi) => (
                            <div key={qi} className="flex flex-col" style={{ gap: 4 }}>
                              <div className="flex items-center" style={{ gap: 8, fontSize: 12 }}>
                                <span title={q.title} style={{ flex: 1, minWidth: 0, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  ↓ {cleanTitle(q.title)}
                                </span>
                                <span style={{ color: "var(--text-label)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                                  {q.pct}%{fmtEtaShort(q.etaSec) ? ` · ${fmtEtaShort(q.etaSec)}` : ""}
                                </span>
                              </div>
                              <GaugeBar percent={q.pct} color="var(--data-strong)" thin />
                            </div>
                          ))}
                          {streams.map((st2, si) => (
                            <div key={si} className="flex flex-col" style={{ gap: 4 }}>
                              <span title={`${st2.title}${st2.user ? `, ${st2.user}` : ""}${st2.posStr ? ` (${st2.posStr})` : ""}`}
                                style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                ▶ {st2.title}{st2.user ? <span style={{ color: "var(--text-label)" }}> · {st2.user}</span> : null}
                              </span>
                              <GaugeBar percent={Math.min(100, st2.progress)} color="var(--data-strong)" thin />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {/* Every category returns null when the filter matches nothing; say
              so instead of collapsing to an empty panel. */}
          {filter !== "" && !configured.some(s => s.name.toLowerCase().includes(filter) || (SVC_LABELS[s.name] ?? "").toLowerCase().includes(filter)) && (
            <span style={{ fontSize: 12, color: "var(--text-ghost)", padding: "10px 0", borderTop: "1px solid var(--border-subtle)" }}>
              No services match &ldquo;{serviceFilter.trim()}&rdquo;. Esc to clear.
            </span>
          )}
        </>
      )}

      {detailService && (
        <ServiceDetailSheet
          service={detailService}
          resolvedUrl={urlFor(detailService.name)}
          color={SVC_COLORS[detailService.name] ?? "#666"}
          iconSrc={SVC_ICONS[detailService.name]}
          label={SVC_LABELS[detailService.name] ?? detailService.name}
          onClose={() => setDetailServiceName(null)}
          onViewLogs={(n) => { setDetailServiceName(null); setLogsContainer(n); }}
          onRestart={(n) => { restartService(n); }}
          dockerEnabled={clientConfig?.dockerEnabled}
        />
      )}
    </section>
  );
}
