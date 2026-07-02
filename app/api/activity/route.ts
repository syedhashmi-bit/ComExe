import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/app/lib/http";
import { loadConfig, type ServiceCreds } from "@/app/lib/server-config";

// ── Activity feed ─────────────────────────────────────────────────────────────
// Pulls recent events from Sonarr / Radarr (grabbed history) and Tautulli
// (watch history), normalizes to a unified shape, sorts newest-first, returns
// the top N combined.
//
// Each individual fetch is wrapped in try/catch and falls back to an empty
// list — one source being down should not blank the whole feed.
//
// 60s cache: history endpoints don't churn fast and they're the slowest of
// the per-service calls.

interface ActivityEvent {
  source: "sonarr" | "radarr" | "tautulli";
  type: "grabbed" | "imported" | "watched";
  title: string;          // primary text — "Severance S02E07" / "Anwar 2007" / "Kitchen Nightmares S02E08"
  subtitle?: string;      // quality / user / etc.
  timestamp: number;      // unix ms
}

const CACHE_TTL  = 120_000; // 2 min — activity feed is informational, not real-time critical
const MAX_EVENTS = 30;

let activityCache: { data: { events: ActivityEvent[]; timestamp: number }; ts: number } | null = null;

// Per-source memo so a cache miss on the top-level doesn't always re-hit all
// three /history endpoints. Each source independently cached 5 min — the
// *arr /history endpoints are real DB queries and were on the list of things
// the throttling pass was meant to spare. 5 min × 3 sources = at most ~36
// history fetches/hour across all browsers, vs the old ~60/hour each.
const memo = new Map<string, { value: ActivityEvent[]; ts: number }>();
const SOURCE_TTL = 300_000;
async function memoSource(key: string, fn: () => Promise<ActivityEvent[]>): Promise<ActivityEvent[]> {
  const c = memo.get(key);
  if (c && Date.now() - c.ts < SOURCE_TTL) return c.value;
  try {
    const v = await fn();
    memo.set(key, { value: v, ts: Date.now() });
    return v;
  } catch {
    memo.set(key, { value: [], ts: Date.now() });
    return [];
  }
}

// Thin wrapper over the shared helper: history callers rely on throw-on-failure
// (memoSource catches and falls back to []), so keep that instead of fetchJson's
// null-on-failure.
async function jsonFetch(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetchWithTimeout(url, {
    timeoutMs: 8000,
    headers: { Accept: "application/json", ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Strip release-group/quality noise from torrent-style titles so the feed reads
// cleanly. e.g. "Severance.S02E07.1080p.WEB-DL.x264-GROUP" → "Severance S02E07".
function cleanReleaseTitle(s: string): string {
  if (!s) return s;
  let t = s.replace(/\.(mkv|mp4|avi)$/i, "");
  // chop everything from the first quality/codec/source token onward
  const cutoff = t.search(/\b(720p|1080p|2160p|4K|UHD|HDR|WEB-?DL|WEBRIP|BluRay|BDRip|BRRip|HDTV|x264|x265|H\.?264|H\.?265|HEVC|REPACK|PROPER|DV|DDP?5|AC3)\b/i);
  if (cutoff > 0) t = t.slice(0, cutoff);
  return t.replace(/[._]/g, " ").trim();
}

// ── Sonarr ────────────────────────────────────────────────────────────────────
interface SonarrHistoryRecord {
  date?: string;
  eventType?: string;
  sourceTitle?: string;
  quality?: { quality?: { name?: string } };
  series?:  { title?: string };
  episode?: { title?: string; seasonNumber?: number; episodeNumber?: number };
}
async function sonarrEvents(creds: ServiceCreds): Promise<ActivityEvent[]> {
  if (!creds.configured) return [];
  const KEY = creds.apiKey ?? "";
  try {
    const data = await jsonFetch(
      `${creds.url}/api/v3/history?pageSize=20&sortKey=date&sortDirection=descending&includeEpisode=true&includeSeries=true&apiKey=${KEY}`
    ) as { records?: SonarrHistoryRecord[] };
    const records = data.records ?? [];
    return records
      .filter(r => r.eventType === "grabbed" || r.eventType === "downloadFolderImported")
      .map(r => {
        const series = r.series?.title ?? "";
        const ep     = r.episode;
        const seCode = ep?.seasonNumber != null && ep?.episodeNumber != null
          ? `S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber).padStart(2, "0")}`
          : "";
        const title  = series && seCode ? `${series} ${seCode}`
                     : series           ? series
                     : cleanReleaseTitle(r.sourceTitle ?? "");
        const ts = r.date ? Date.parse(r.date) : NaN;
        if (!title || isNaN(ts)) return null;
        return {
          source:    "sonarr" as const,
          type:      r.eventType === "grabbed" ? "grabbed" as const : "imported" as const,
          title,
          subtitle:  r.quality?.quality?.name ?? undefined,
          timestamp: ts,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  } catch {
    return [];
  }
}

// ── Radarr ────────────────────────────────────────────────────────────────────
interface RadarrHistoryRecord {
  date?: string;
  eventType?: string;
  sourceTitle?: string;
  quality?: { quality?: { name?: string } };
  movie?:   { title?: string; year?: number };
}
async function radarrEvents(creds: ServiceCreds): Promise<ActivityEvent[]> {
  if (!creds.configured) return [];
  const KEY = creds.apiKey ?? "";
  try {
    const data = await jsonFetch(
      `${creds.url}/api/v3/history?pageSize=20&sortKey=date&sortDirection=descending&includeMovie=true&apiKey=${KEY}`
    ) as { records?: RadarrHistoryRecord[] };
    const records = data.records ?? [];
    return records
      .filter(r => r.eventType === "grabbed" || r.eventType === "downloadFolderImported")
      .map(r => {
        const mv     = r.movie;
        const title  = mv?.title
          ? (mv.year ? `${mv.title} (${mv.year})` : mv.title)
          : cleanReleaseTitle(r.sourceTitle ?? "");
        const ts = r.date ? Date.parse(r.date) : NaN;
        if (!title || isNaN(ts)) return null;
        return {
          source:    "radarr" as const,
          type:      r.eventType === "grabbed" ? "grabbed" as const : "imported" as const,
          title,
          subtitle:  r.quality?.quality?.name ?? undefined,
          timestamp: ts,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  } catch {
    return [];
  }
}

// ── Tautulli ──────────────────────────────────────────────────────────────────
interface TautulliHistoryRow {
  full_title?:    string;
  friendly_name?: string;
  user?:          string;
  started?:       number;            // unix seconds
  date?:          number;            // unix seconds, alternative
  watched_status?: number;
  media_type?:    string;
  grandparent_title?: string;
  parent_media_index?: string | number;
  media_index?:        string | number;
  title?:         string;
}
async function tautulliEvents(creds: ServiceCreds): Promise<ActivityEvent[]> {
  if (!creds.configured) return [];
  const KEY = creds.apiKey ?? "";
  try {
    const data = await jsonFetch(
      `${creds.url}/api/v2?apikey=${KEY}&cmd=get_history&length=20&order_column=date&order_dir=desc`
    ) as { response?: { data?: { data?: TautulliHistoryRow[] } } };
    const rows = data.response?.data?.data ?? [];
    return rows.map(r => {
      // Build a clean title: prefer "Show SXXEXX" for episodes
      let title = r.full_title ?? r.title ?? "";
      if (r.media_type === "episode" && r.grandparent_title) {
        const se = r.parent_media_index != null && r.media_index != null
          ? `S${String(r.parent_media_index).padStart(2, "0")}E${String(r.media_index).padStart(2, "0")}`
          : "";
        title = se ? `${r.grandparent_title} ${se}` : r.grandparent_title;
      }
      const tsSec = r.date ?? r.started;
      const ts    = typeof tsSec === "number" ? tsSec * 1000 : NaN;
      if (!title || isNaN(ts)) return null;
      return {
        source:    "tautulli" as const,
        type:      "watched" as const,
        title,
        subtitle:  r.friendly_name ?? r.user ?? undefined,
        timestamp: ts,
      };
    }).filter((e): e is NonNullable<typeof e> => e !== null);
  } catch {
    return [];
  }
}

// ── Aggregator ────────────────────────────────────────────────────────────────
export async function GET() {
  if (activityCache && Date.now() - activityCache.ts < CACHE_TTL) {
    return NextResponse.json(activityCache.data);
  }

  const cfg = await loadConfig();
  const [sonarr, radarr, tautulli] = await Promise.all([
    memoSource(`sonarr:${cfg.services.sonarr.url}`,     () => sonarrEvents(cfg.services.sonarr)),
    memoSource(`radarr:${cfg.services.radarr.url}`,     () => radarrEvents(cfg.services.radarr)),
    memoSource(`tautulli:${cfg.services.tautulli.url}`, () => tautulliEvents(cfg.services.tautulli)),
  ]);

  const events = [...sonarr, ...radarr, ...tautulli]
    .filter(e => !isNaN(e.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_EVENTS);

  const data = { events, timestamp: Date.now() };
  activityCache = { data, ts: Date.now() };
  return NextResponse.json(data);
}
