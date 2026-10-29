"use client";

import { useEffect, useState } from "react";
import type { ActivityEvent } from "@/app/lib/types";
import { SVC_ICONS, SVC_LABELS } from "@/app/lib/constants";

// How many events show before "Show all". /api/activity already returns the
// newest ~40, sorted newest-first.
const COLLAPSED = 6;

export function relativeAgo(unixMs: number): string {
  const sec = Math.max(0, Math.round((Date.now() - unixMs) / 1000));
  if (sec < 60)    return `${sec}s ago`;
  if (sec < 3600)  return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function SourceIcon({ source }: { source: string }) {
  const [err, setErr] = useState(false);
  const src = SVC_ICONS[source];
  if (!src || err) {
    return (
      <span aria-hidden="true" className="inline-flex items-center justify-center shrink-0"
        style={{ width: 20, height: 20, borderRadius: 5, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
        {source[0]?.toUpperCase()}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- 20px static icon from /public, no optimisation needed
  return <img src={src} alt="" width={20} height={20} className="shrink-0" style={{ width: 20, height: 20, borderRadius: 4, objectFit: "contain" }} onError={() => setErr(true)} />;
}

function ActivityRow({ ev, first }: { ev: ActivityEvent; first: boolean }) {
  const app = SVC_LABELS[ev.source] ?? ev.source;
  // Tautulli's subtitle is the viewer; the *arrs' is the release quality.
  const detail = ev.source === "tautulli"
    ? `${app} · watched${ev.subtitle ? ` by ${ev.subtitle}` : ""}`
    : `${app} · ${ev.type}${ev.subtitle ? ` · ${ev.subtitle}` : ""}`;
  return (
    <li className="flex items-center gap-3"
      style={{ padding: "9px 0", borderTop: first ? undefined : "1px solid var(--divider)" }}>
      <SourceIcon source={ev.source} />
      <div className="flex flex-col min-w-0 flex-1" style={{ gap: 1 }}>
        <span className="truncate" title={ev.title} style={{ fontSize: 13, color: "var(--text-secondary)" }}>{ev.title}</span>
        <span className="truncate" style={{ fontSize: 12, color: "var(--text-faint)" }}>{detail}</span>
      </div>
      <span className="shrink-0" title={new Date(ev.timestamp).toLocaleString()}
        style={{ fontSize: 12, color: "var(--text-ghost)", fontVariantNumeric: "tabular-nums" }}>
        {relativeAgo(ev.timestamp)}
      </span>
    </li>
  );
}

// A plain, still list of the latest grabs, imports and watches — it used to be
// a scrolling ticker, which kept the eye moving on a page meant to be calm.
export function ActivityFeed({ events, loading }: { events: ActivityEvent[]; loading: boolean }) {
  const [showAll, setShowAll] = useState(false);
  // Re-render every 30s so the relative times stay current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!loading && events.length === 0) return null;

  const shown = showAll ? events : events.slice(0, COLLAPSED);

  return (
    <section aria-label="Recent activity" style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "14px 16px 8px",
    }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Recent activity</span>
        {events.length > COLLAPSED && (
          <button onClick={() => setShowAll(v => !v)}
            className="ml-auto"
            style={{ fontSize: 12, color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
            {showAll ? "Show less" : `Show all ${events.length}`}
          </button>
        )}
      </div>
      {loading && events.length === 0 ? (
        <div className="skeleton rounded" style={{ height: 36, margin: "8px 0 10px" }} />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {shown.map((ev, i) => (
            <ActivityRow key={`${ev.source}-${ev.timestamp}-${i}`} ev={ev} first={i === 0} />
          ))}
        </ul>
      )}
    </section>
  );
}
