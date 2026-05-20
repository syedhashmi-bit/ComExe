"use client";

import { useEffect, useState } from "react";
import type { ActivityEvent } from "@/app/lib/types";

const SVC_COLORS: Record<string, string> = {
  radarr: "#f5c518", sonarr: "#35c5f4", bazarr: "#4a90d9",
  tautulli: "#e5a00d", qbittorrent: "#2196f3", overseerr: "#e5a00d",
  pihole: "#f60d1a", prowlarr: "#ff8c00", nginx: "#2ecc71",
  uptimekuma: "#5cdd8b",
};

export function relativeAgo(unixMs: number): string {
  const sec = Math.max(0, Math.round((Date.now() - unixMs) / 1000));
  if (sec < 60)    return `${sec}s ago`;
  if (sec < 3600)  return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function ActivityEventPill({ ev }: { ev: ActivityEvent }) {
  const color = SVC_COLORS[ev.source] ?? "#888";
  const verb  = ev.type === "grabbed"  ? "grabbed"
              : ev.type === "imported" ? "imported"
                                       : "watched";
  return (
    <span className="flex items-center gap-1.5 shrink-0" style={{ paddingInline: 14 }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color, boxShadow: `0 0 5px ${color}aa` }} />
      <span style={{
        color, fontSize: 9, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.1em",
      }}>{ev.source}</span>
      <span style={{ color: "var(--text-faint)", fontSize: 10 }}>{verb}</span>
      <span
        title={`${ev.title}${ev.subtitle ? ` · ${ev.subtitle}` : ""} — ${new Date(ev.timestamp).toLocaleString()}`}
        style={{
          color: "var(--text-secondary)", fontSize: 11, fontWeight: 500,
          maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{ev.title}</span>
      {ev.subtitle && (
        <span
          title={ev.subtitle}
          style={{
            color: "var(--text-faint)", fontSize: 10,
            maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>· {ev.subtitle}</span>
      )}
      <span style={{
        color: "var(--text-ghost)", fontSize: 9,
        fontVariantNumeric: "tabular-nums",
      }}>· {relativeAgo(ev.timestamp)}</span>
    </span>
  );
}

export function ActivityFeed({ events, loading }: { events: ActivityEvent[]; loading: boolean }) {
  const [hov, setHov] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (loading && events.length === 0) {
    return (
      <div style={{
        height: 36, background: "var(--surface-dim)",
        border: "1px solid var(--border-dim)", borderRadius: 10,
        display: "flex", alignItems: "center", padding: "0 14px",
      }}>
        <span className="text-[10px] uppercase" style={{ color: "var(--text-ghost)", letterSpacing: "0.18em" }}>
          loading activity…
        </span>
      </div>
    );
  }
  if (events.length === 0) return null;

  const looped = [...events, ...events];
  const duration = Math.max(30, events.length * 6);

  return (
    <div className="relative overflow-hidden"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: 36,
        background: "var(--surface-dim)",
        border: "1px solid var(--border-dim)",
        borderRadius: 10,
      }}>
      <div className="absolute inset-y-0 left-0 z-10 flex items-center pointer-events-none"
        style={{
          paddingLeft: 12, paddingRight: 32,
          minWidth: 110,
          background: "linear-gradient(to right, var(--fade-to) 70%, transparent)",
        }}>
        <span className="text-[9px] uppercase" style={{
          color: "var(--text-label)", letterSpacing: "0.22em", fontWeight: 700,
        }}>
          activity
        </span>
      </div>
      <div className="absolute inset-y-0 flex items-center" style={{
        left: 120,
        animation: `tickerScroll ${duration}s linear infinite`,
        animationPlayState: hov ? "paused" : "running",
        willChange: "transform",
      }}>
        {looped.map((ev, i) => (
          <ActivityEventPill key={`${ev.source}-${ev.timestamp}-${i}`} ev={ev} />
        ))}
      </div>
      <div className="absolute inset-y-0 right-0 pointer-events-none"
        style={{ width: 40, background: "linear-gradient(to left, var(--fade-to), transparent)" }} />
    </div>
  );
}
