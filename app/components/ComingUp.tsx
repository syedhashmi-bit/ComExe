"use client";

import { useCallback, useState } from "react";
import type { CalendarFeed, CalendarItem } from "@/app/lib/types";
import { usePollingInterval } from "@/app/hooks/usePolling";
import { isDemoMode } from "@/app/lib/demo-data";
import { SourceIcon } from "@/app/components/ActivityFeed";

// What's airing and releasing over the next 7 days, from the Sonarr and Radarr
// calendars (/api/calendar), grouped by day. Above the list, anything that
// aired more than a day ago and still has no file — the one thing here worth
// acting on.

const DAY = 86_400_000;
const COLLAPSED = 8;
// Newer than this and an aired episode is probably still downloading.
const MISSING_AFTER = DAY;

function dateKeyFmt(tz: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  }
}

// YYYY-MM-DD in the dashboard's timezone. A release date is a date, not an
// instant: use its UTC date, or a US timezone would show it a day early.
export function dayKeyOf(it: CalendarItem, tz: string): string {
  return it.allDay ? new Date(it.at).toISOString().slice(0, 10) : dateKeyFmt(tz).format(it.at);
}

export function isMissing(it: CalendarItem, now: number): boolean {
  return !it.hasFile && it.kind !== "cinema" && it.at < now - MISSING_AFTER;
}

export function itemState(it: CalendarItem, now: number, tz: string): { text: string; done: boolean } {
  if (it.hasFile) return { text: "Downloaded", done: true };
  const future = it.at > now;
  if (it.kind === "cinema")   return { text: "In cinemas", done: false };
  if (it.kind === "digital")  return { text: future ? "Digital release" : "Released", done: false };
  if (it.kind === "physical") return { text: future ? "Disc release" : "Released", done: false };
  if (!future) return { text: "Aired", done: false };
  let time: string;
  try {
    time = new Date(it.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz || undefined });
  } catch {
    time = new Date(it.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return { text: time, done: false };
}

const label = (it: CalendarItem) => it.detail ? `${it.title} ${it.detail}` : it.title;

function demoFeed(): CalendarFeed {
  const now = Date.now(), h = 3_600_000;
  const ep = (title: string, detail: string, at: number, hasFile = false): CalendarItem =>
    ({ source: "sonarr", kind: "episode", title, detail, at, hasFile });
  return {
    sources: { sonarr: "ok", radarr: "ok" },
    timestamp: now,
    items: [
      ep("Slow Horses", "S05E03", now - 2 * 24 * h),
      ep("The Bear", "S04E09", now - 3 * h, true),
      ep("Shogun", "S02E05", now + 2 * h),
      ep("Slow Horses", "S05E04", now + 2 * 24 * h),
      { source: "radarr", kind: "digital", title: "Dune: Part Three (2026)", detail: "", at: Math.floor((now + 4 * 24 * h) / (24 * h)) * 24 * h, hasFile: false, allDay: true },
      ep("The Bear", "S04E10", now + 6 * 24 * h),
    ],
  };
}

export function ComingUp({ timezone, sonarrUrl }: { timezone: string; sonarrUrl?: string }) {
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Demo data arrives through the same path as real data — after mount — so
  // the server render and the first client render agree (both empty).
  const load = useCallback(async () => {
    if (isDemoMode()) { setFeed(demoFeed()); return; }
    try {
      const res = await fetch("/api/calendar", { cache: "no-store" });
      if (res.ok) setFeed(await res.json());
    } catch { /* keep the last one */ }
  }, []);
  usePollingInterval(load, 15 * 60_000);

  const f = feed;
  if (!f || (f.sources.sonarr === "unconfigured" && f.sources.radarr === "unconfigured")) return null;

  const now = f.timestamp;
  const fmt = dateKeyFmt(timezone);
  const today = fmt.format(now), tomorrow = fmt.format(now + DAY), last = fmt.format(now + 7 * DAY);

  const missing = f.items.filter(it => isMissing(it, now)).reverse();
  const upcoming = f.items.filter(it => { const k = dayKeyOf(it, timezone); return k >= today && k <= last; });

  const groups: { key: string; items: CalendarItem[] }[] = [];
  for (const it of upcoming) {
    const key = dayKeyOf(it, timezone);
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.items.push(it); else groups.push({ key, items: [it] });
  }
  // "Sat 31". Built by hand: some locales order { weekday, day } as "31 Sat".
  const dayLabel = (key: string) => {
    if (key === today) return "Today";
    if (key === tomorrow) return "Tomorrow";
    const d = new Date(`${key}T12:00:00Z`);
    return `${d.toLocaleDateString([], { weekday: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
  };

  const episodes = upcoming.filter(it => it.kind === "episode").length;
  const movies = new Set(upcoming.filter(it => it.kind !== "episode").map(it => it.title)).size;
  const summary = [
    episodes ? `${episodes} episode${episodes === 1 ? "" : "s"}` : null,
    movies ? `${movies} movie${movies === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  // Collapse to the first COLLAPSED rows across days.
  let budget = showAll ? Infinity : COLLAPSED;
  const shown = groups.map(g => {
    const items = g.items.slice(0, Math.max(0, budget));
    budget -= items.length;
    return { ...g, items };
  }).filter(g => g.items.length > 0);

  const failed = (["sonarr", "radarr"] as const).filter(s => f.sources[s] === "error");
  const allEpisodes = missing.every(it => it.kind === "episode");
  const missingNoun = allEpisodes ? `aired episode${missing.length === 1 ? "" : "s"}` : `release${missing.length === 1 ? "" : "s"}`;

  return (
    <section aria-label="Coming up" style={{
      background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div className="flex items-center gap-2">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-system)", flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Coming up</span>
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>next 7 days</span>
        {summary && <span className="ml-auto" style={{ fontSize: 12, color: "var(--text-faint)" }}>{summary}</span>}
      </div>

      {missing.length > 0 && (
        <div className="flex flex-wrap items-baseline" style={{ columnGap: 8, rowGap: 2, border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12 }}>
          <span className="flex items-center gap-1.5" style={{ color: "var(--warn)", fontWeight: 600 }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: "var(--warn)" }} />
            Missing
          </span>
          <span style={{ color: "var(--text-secondary)" }}>{missing.length} {missingNoun} not downloaded:</span>
          <span style={{ color: "var(--text-faint)", minWidth: 0 }}>
            {missing.slice(0, 2).map(label).join(", ")}{missing.length > 2 ? ` and ${missing.length - 2} more` : ""}
          </span>
          {sonarrUrl && missing.some(it => it.source === "sonarr") && (
            <a href={`${sonarrUrl.replace(/\/+$/, "")}/wanted/missing`} target="_blank" rel="noopener noreferrer"
              style={{ marginLeft: "auto", color: "var(--brand)", whiteSpace: "nowrap" }}>Open in Sonarr ↗</a>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
          {failed.length > 0 ? `Couldn't reach ${failed.map(s => s === "sonarr" ? "Sonarr" : "Radarr").join(" or ")}.` : "Nothing scheduled in the next 7 days."}
        </span>
      ) : (
        <div className="flex flex-col" style={{ gap: 8 }}>
          {shown.map(g => (
            <div key={g.key} className="flex flex-col">
              <span style={{ fontSize: 12, fontWeight: 600, color: g.key === today ? "var(--text-secondary)" : "var(--text-dim)", padding: "2px 0 4px" }}>
                {dayLabel(g.key)}
              </span>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {g.items.map((it, i) => {
                  const st = itemState(it, now, timezone);
                  return (
                    <li key={`${it.source}-${it.title}-${it.detail}-${it.at}`} className="flex items-center gap-3"
                      style={{ padding: "6px 0", borderTop: i ? "1px solid var(--divider)" : undefined }}>
                      <SourceIcon source={it.source} />
                      <span className="flex items-baseline gap-2 min-w-0 flex-1">
                        <span className="truncate" title={it.title} style={{ fontSize: 13, color: "var(--text-secondary)" }}>{it.title}</span>
                        {it.detail && <span className="font-mono shrink-0" style={{ fontSize: 12, color: "var(--text-faint)" }}>{it.detail}</span>}
                      </span>
                      <span className="flex items-center gap-1 shrink-0 tabular-nums" style={{ fontSize: 12, color: st.done ? "var(--text-muted)" : "var(--text-faint)" }}>
                        {st.done && (
                          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        )}
                        {st.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {upcoming.length > COLLAPSED && (
        <button onClick={() => setShowAll(v => !v)} className="self-start"
          style={{ fontSize: 12, color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
          {showAll ? "Show less" : `Show all ${upcoming.length}`}
        </button>
      )}
    </section>
  );
}
