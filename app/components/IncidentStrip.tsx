"use client";

import { useCallback, useState } from "react";
import type { Incident } from "@/app/lib/types";
import { fmtDuration } from "@/app/lib/formatters";
import { usePollingInterval } from "@/app/hooks/usePolling";

// The last 24 hours of the collector's incident log as a strip of 15-minute
// cells. Grey everywhere nothing went wrong; amber or red only where something
// did. Hovering a cell says what happened in it, in the line under the strip.

const CELLS = 96;
const CELL_MS = 15 * 60_000;

export interface IncidentFeed {
  enabled:   boolean;
  now?:      number;
  incidents?: Incident[];
  last?:     Incident | null;
}

function demoFeed(): IncidentFeed {
  const now = Date.now(), h = 3_600_000;
  const radarr: Incident = { key: "service:radarr:down", level: "critical", title: "Radarr unreachable", start: now - 10 * h, end: now - 10 * h + 12 * 60_000 };
  const mem: Incident = { key: "mem", level: "warning", title: "High memory", start: now - 20 * h, end: now - 20 * h + 6 * 60_000 };
  return { enabled: true, now, incidents: [radarr, mem], last: radarr };
}

// The collector's incident log, refreshed every minute. Demo mode gets a
// made-up day with two incidents and makes no request.
export function useIncidents(demoMode: boolean): IncidentFeed | null {
  const [feed, setFeed] = useState<IncidentFeed | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/incidents?hours=24", { cache: "no-store" });
      if (res.ok) setFeed(await res.json());
    } catch { /* keep the last answer */ }
  }, []);
  usePollingInterval(load, 60_000, { enabled: !demoMode });
  return demoMode ? demoFeed() : feed;
}

// Worst incident level in each 15-minute cell, oldest cell first. Exported for tests.
export function cellLevels(incidents: Incident[], now: number): ("warning" | "critical" | null)[] {
  return Array.from({ length: CELLS }, (_, i) => {
    const from = now - (CELLS - i) * CELL_MS, to = from + CELL_MS;
    let level: "warning" | "critical" | null = null;
    for (const inc of incidents) {
      if (inc.start < to && (inc.end ?? now) > from) {
        if (inc.level === "critical") return "critical";
        level = "warning";
      }
    }
    return level;
  });
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function IncidentStrip({ incidents, now }: { incidents: Incident[]; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const levels = cellLevels(incidents, now);
  const inWindow = incidents.filter(i => (i.end ?? now) > now - CELLS * CELL_MS);

  let caption = inWindow.length === 0 ? "Last 24 hours · no incidents"
    : `Last 24 hours · ${inWindow.length} incident${inWindow.length === 1 ? "" : "s"}`;
  if (hover != null) {
    const from = now - (CELLS - hover) * CELL_MS, to = from + CELL_MS;
    const here = incidents.filter(i => i.start < to && (i.end ?? now) > from);
    caption = here.length === 0 ? `${hhmm(from)}–${hhmm(to)} · nothing wrong`
      : here.map(i => `${i.title} · ${hhmm(i.start)}–${i.end ? hhmm(i.end) : "now"} (${fmtDuration((i.end ?? now) - i.start)})`).join("  ·  ");
  }

  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <div role="img" aria-label={caption} className="flex" style={{ gap: 1, height: 10 }}
        onMouseLeave={() => setHover(null)}>
        {levels.map((l, i) => (
          <span key={i} onMouseEnter={() => setHover(i)} style={{
            flex: 1, borderRadius: 2,
            background: l === "critical" ? "var(--critical)" : l === "warning" ? "var(--warn)" : "var(--gauge-track)",
            boxShadow: hover === i ? "0 0 0 1px var(--text-muted)" : undefined,
          }} />
        ))}
      </div>
      <div className="flex items-baseline justify-between" style={{ gap: 12, fontSize: 12, color: "var(--text-ghost)" }}>
        <span className="font-mono" style={{ flexShrink: 0 }}>24 h ago</span>
        <span className="truncate" style={{ color: hover != null ? "var(--text-muted)" : "var(--text-ghost)", minWidth: 0 }}>{caption}</span>
        <span className="font-mono" style={{ flexShrink: 0 }}>Now</span>
      </div>
    </div>
  );
}
