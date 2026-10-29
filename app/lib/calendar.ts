// ── Coming up: Sonarr + Radarr calendars ────────────────────────────────────
// The logic behind /api/calendar: episodes airing and movies releasing over
// the next 7 days, plus the last 7 so the card can say which aired episodes
// haven't downloaded. Cached 15 minutes — a calendar doesn't change by the
// minute, and these are real database queries on the *arr containers (the
// load story in CLAUDE.md).
//
// The API key goes in the X-Api-Key header rather than the query string, so
// it never lands in an access log.
//
// IMPORTANT: server-only. Never import from "use client" modules.

import { fetchJson } from "@/app/lib/http";
import { createTTLCache } from "@/app/lib/cache";
import { loadConfig, type ServiceCreds } from "@/app/lib/server-config";
import type { CalendarFeed, CalendarItem } from "@/app/lib/types";

const DAY = 86_400_000;
export const WINDOW_DAYS = 7;
const MAX_ITEMS = 120;

interface SonarrEpisode {
  seasonNumber?: number;
  episodeNumber?: number;
  airDateUtc?: string;
  hasFile?: boolean;
  series?: { title?: string };
}

interface RadarrMovie {
  title?: string;
  year?: number;
  hasFile?: boolean;
  inCinemas?: string;
  physicalRelease?: string;
  digitalRelease?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function sonarrItems(episodes: SonarrEpisode[]): CalendarItem[] {
  return episodes.flatMap((e) => {
    const at = e.airDateUtc ? Date.parse(e.airDateUtc) : NaN;
    const title = e.series?.title;
    if (!title || isNaN(at)) return [];
    const detail = e.seasonNumber != null && e.episodeNumber != null ? `S${pad(e.seasonNumber)}E${pad(e.episodeNumber)}` : "";
    return [{ source: "sonarr" as const, kind: "episode" as const, title, detail, at, hasFile: !!e.hasFile }];
  });
}

// A movie can have several release dates; Radarr's calendar returns it when
// any of them falls in the window, so emit one item per date that does. They
// are dates, not times, so the item is all-day.
export function radarrItems(movies: RadarrMovie[], from: number, to: number): CalendarItem[] {
  const kinds = [
    ["digitalRelease",  "digital"],
    ["physicalRelease", "physical"],
    ["inCinemas",       "cinema"],
  ] as const;
  return movies.flatMap((m) => {
    if (!m.title) return [];
    const title = m.year ? `${m.title} (${m.year})` : m.title;
    return kinds.flatMap(([field, kind]) => {
      const at = m[field] ? Date.parse(m[field]!) : NaN;
      if (isNaN(at) || at < from || at > to) return [];
      return [{ source: "radarr" as const, kind, title, detail: "", at, hasFile: !!m.hasFile, allDay: true }];
    });
  });
}

async function fetchArr<T>(creds: ServiceCreds, path: string): Promise<T[] | null> {
  const data = await fetchJson<T[]>(`${creds.url}${path}`, {
    timeoutMs: 8_000,
    headers: { "X-Api-Key": creds.apiKey ?? "", Accept: "application/json" },
  });
  return Array.isArray(data) ? data : null;
}

const cache = createTTLCache<CalendarFeed>(15 * 60_000);
let inflight: Promise<CalendarFeed> | null = null;

export async function getCalendar(): Promise<CalendarFeed> {
  const cached = cache.get();
  if (cached) return cached;
  if (!inflight) {
    inflight = fetchCalendar()
      .then((v) => { cache.set(v); return v; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

async function fetchCalendar(): Promise<CalendarFeed> {
  const cfg = await loadConfig();
  const now = Date.now();
  const from = now - WINDOW_DAYS * DAY, to = now + WINDOW_DAYS * DAY;
  const range = `start=${new Date(from).toISOString()}&end=${new Date(to).toISOString()}&unmonitored=false`;
  const { sonarr, radarr } = cfg.services;

  const [eps, movies] = await Promise.all([
    sonarr.configured ? fetchArr<SonarrEpisode>(sonarr, `/api/v3/calendar?${range}&includeSeries=true`) : Promise.resolve(null),
    radarr.configured ? fetchArr<RadarrMovie>(radarr, `/api/v3/calendar?${range}`) : Promise.resolve(null),
  ]);

  const items = [...sonarrItems(eps ?? []), ...radarrItems(movies ?? [], from, to)]
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_ITEMS);

  const status = (configured: boolean, data: unknown[] | null) =>
    !configured ? "unconfigured" as const : data ? "ok" as const : "error" as const;

  return {
    sources: { sonarr: status(sonarr.configured, eps), radarr: status(radarr.configured, movies) },
    items,
    timestamp: now,
  };
}
