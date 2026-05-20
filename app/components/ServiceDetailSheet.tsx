"use client";

import { useEffect } from "react";
import type { ServiceResult } from "@/app/lib/types";
import { cleanTitle, fmtEtaShort, fmtSmoothAgo } from "@/app/lib/formatters";
import { GaugeBar } from "@/app/components/primitives";

interface ServiceDetailSheetProps {
  service: ServiceResult;
  resolvedUrl?: string;
  color: string;
  iconSrc?: string;
  label: string;
  onClose: () => void;
  onViewLogs?: (name: string) => void;
  onRestart?:  (name: string) => void;
  dockerEnabled?: boolean;
}

// A right-side slide-in sheet that shows the full detail of a service card —
// every queue item, every stream, all health messages, the resolved URL,
// and any service-specific stats. Triggered by the small "expand" button on
// each card; the card body click still opens the upstream service in a new
// tab so power users keep their workflow.
export function ServiceDetailSheet({
  service, resolvedUrl, color, iconSrc, label, onClose,
  onViewLogs, onRestart, dockerEnabled,
}: ServiceDetailSheetProps) {
  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const queueItems = service.queueItems ?? (service.queueItem ? [service.queueItem] : []);
  const streams    = service.streams ?? [];

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div
        className="fixed z-50 flex flex-col"
        style={{
          top: 0, right: 0, bottom: 0, width: "min(480px, 100vw)",
          background: "var(--card)", borderLeft: "1px solid var(--border-bright)",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
          animation: "fadeSlideIn 0.25s ease-out",
        }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--border-dim)" }}>
          {iconSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iconSrc} alt={label} style={{ width: 32, height: 32, borderRadius: 6 }} />
          ) : (
            <div style={{
              width: 32, height: 32, borderRadius: 6, background: color,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color: "#fff",
            }}>{label[0]?.toUpperCase()}</div>
          )}
          <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{label}</span>
              <span className="w-1.5 h-1.5 rounded-full" style={{
                background: service.stale ? "#f59e0b" : service.up ? "#10b981" : "#ef4444",
                boxShadow: `0 0 6px ${service.stale ? "#f59e0baa" : service.up ? "#10b981aa" : "#ef444455"}`,
              }} />
              <span style={{ fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                {service.stale ? "stale" : service.up ? "online" : "offline"}
              </span>
              {service.authError && (
                <span style={{
                  background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)",
                  color: "#ef4444", borderRadius: 4, padding: "1px 5px",
                  fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                }}>AUTH</span>
              )}
            </div>
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 10, color: "var(--text-ghost)", fontFamily: "monospace", textDecoration: "none" }}
                onMouseEnter={e => e.currentTarget.style.color = "var(--brand)"}
                onMouseLeave={e => e.currentTarget.style.color = "var(--text-ghost)"}
              >{resolvedUrl.replace(/^https?:\/\//, "")} ↗</a>
            )}
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)",
            fontSize: 18, padding: 4, lineHeight: 1,
          }}>&times;</button>
        </div>

        {/* Body — scrollable */}
        <div className="flex flex-col gap-4" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

          {/* Stats lines */}
          {service.lines.length > 0 && (
            <section className="flex flex-col gap-2">
              <span style={{ fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 700 }}>
                Stats
              </span>
              {service.lines.map((line, i) => (
                <div key={i} style={{
                  fontSize: 12, color: i === 0 ? "var(--text)" : "var(--text-dim)",
                  fontWeight: i === 0 ? 600 : 400,
                  fontVariantNumeric: "tabular-nums", lineHeight: 1.5,
                }}>{line}</div>
              ))}
            </section>
          )}

          {/* Stale-since */}
          {service.stale && service.staleSince && (
            <div style={{
              background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: 8, padding: "8px 12px", fontSize: 10, color: "var(--warn)",
            }}>
              Showing cached data from {fmtSmoothAgo(service.staleSince)}. A background refresh is in progress.
            </div>
          )}

          {/* Health messages */}
          {service.health && (service.health.error > 0 || service.health.warning > 0) && (
            <section className="flex flex-col gap-2">
              <span style={{ fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 700 }}>
                Health · {service.health.error} error{service.health.error === 1 ? "" : "s"} · {service.health.warning} warning{service.health.warning === 1 ? "" : "s"}
              </span>
              {service.health.messages && service.health.messages.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {service.health.messages.map((msg, i) => (
                    <div key={i} className="flex items-start gap-2" style={{
                      fontSize: 11, lineHeight: 1.5, color: "var(--text-mid)",
                    }}>
                      <span style={{ color: "#ef4444", flexShrink: 0, marginTop: 2 }}>•</span>
                      <span style={{ wordBreak: "break-word" }}>{msg}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: 11, color: "var(--text-ghost)", fontStyle: "italic" }}>
                  Open the service to see the full health report.
                </span>
              )}
            </section>
          )}

          {/* Queue items */}
          {queueItems.length > 0 && (
            <section className="flex flex-col gap-2">
              <span style={{ fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 700 }}>
                Active queue · {queueItems.length} item{queueItems.length === 1 ? "" : "s"}
              </span>
              <div className="flex flex-col gap-2">
                {queueItems.map((q, i) => (
                  <div key={i} className="flex flex-col gap-1.5" style={{
                    background: "var(--surface)", borderRadius: 6, padding: "8px 10px",
                  }}>
                    <div className="flex items-center gap-2">
                      <span title={q.title} style={{
                        fontSize: 11, color: color, fontWeight: 500,
                        flex: 1, minWidth: 0,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{cleanTitle(q.title)}</span>
                      {fmtEtaShort(q.etaSec) && (
                        <span style={{ fontSize: 9, color: "var(--text-label)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                          {fmtEtaShort(q.etaSec)}
                        </span>
                      )}
                      <span style={{ fontSize: 9, color: "var(--text-ghost)", fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 32, textAlign: "right" }}>
                        {q.pct}%
                      </span>
                    </div>
                    <GaugeBar percent={q.pct} color={color} thin />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Active streams */}
          {streams.length > 0 && (
            <section className="flex flex-col gap-2">
              <span style={{ fontSize: 9, color: "var(--text-ghost)", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 700 }}>
                Active streams · {streams.length}
              </span>
              <div className="flex flex-col gap-2">
                {streams.map((s, i) => (
                  <div key={i} className="flex flex-col gap-1.5" style={{
                    background: "var(--surface)", borderRadius: 6, padding: "8px 10px",
                  }}>
                    <div className="flex items-center justify-between gap-2">
                      <span title={s.title} style={{
                        fontSize: 11, color: "var(--text-mid)", fontStyle: "italic", fontWeight: 500,
                        flex: 1, minWidth: 0,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{s.title}</span>
                      <span style={{ fontSize: 9, color: "var(--text-ghost)", flexShrink: 0 }}>{s.user}</span>
                    </div>
                    {s.posStr && (
                      <span style={{ fontSize: 9, color: "var(--text-ghost)", fontFamily: "monospace" }}>
                        {s.posStr}
                      </span>
                    )}
                    <div style={{ height: 3, background: "var(--border-subtle)", borderRadius: 2 }}>
                      <div style={{
                        height: "100%", borderRadius: 2,
                        width: `${Math.min(100, s.progress)}%`,
                        background: "#8b5cf6",
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Empty state — no extra detail to show */}
          {service.lines.length === 0 && queueItems.length === 0 && streams.length === 0
            && !(service.health && (service.health.error > 0 || service.health.warning > 0)) && (
              <div style={{
                padding: "24px 0", textAlign: "center", color: "var(--text-ghost)",
                fontSize: 11, fontStyle: "italic",
              }}>
                {service.up
                  ? "No additional detail available for this service yet."
                  : "Service is offline — no detail to display."}
              </div>
            )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-5 py-3"
          style={{ borderTop: "1px solid var(--border-dim)" }}>
          <div className="flex items-center gap-2">
            {dockerEnabled && onViewLogs && (
              <button
                onClick={() => onViewLogs(service.name)}
                style={{
                  background: "var(--card-alt)", border: "1px solid var(--border)",
                  borderRadius: 5, padding: "4px 10px",
                  fontSize: 10, color: "var(--text-dim)", cursor: "pointer",
                }}>View logs</button>
            )}
            {dockerEnabled && onRestart && (
              <button
                onClick={() => {
                  if (confirm(`Restart ${label}?`)) onRestart(service.name);
                }}
                style={{
                  background: "var(--card-alt)", border: "1px solid var(--border)",
                  borderRadius: 5, padding: "4px 10px",
                  fontSize: 10, color: "var(--text-dim)", cursor: "pointer",
                }}>↻ Restart</button>
            )}
          </div>
          {resolvedUrl && (
            <a
              href={resolvedUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: color, color: "var(--bg)", borderRadius: 5,
                padding: "4px 10px", fontSize: 10, fontWeight: 600,
                textDecoration: "none",
              }}>Open {label} ↗</a>
          )}
        </div>
      </div>
    </>
  );
}
