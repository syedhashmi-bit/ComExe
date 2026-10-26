// ── Shared constants ────────────────────────────────────────────────────────
// Single source of truth for data that's duplicated across page.tsx, setup/,
// and welcome/. Import from here instead of re-declaring.

// ── Theme definitions ───────────────────────────────────────────────────────

export type ThemeKey = "midnight" | "paper";

export interface ThemeDef {
  key:   ThemeKey;
  label: string;
  desc:  string;
  bg:    string;
  brand: string;
  card:  string;
  text:  string;
}

export const THEMES: ThemeDef[] = [
  { key: "midnight", label: "Midnight",  desc: "Calm dark, neutral greys",  bg: "#0c0d10", brand: "#22b8cf", card: "#14161a", text: "#e6e8eb" },
  { key: "paper",    label: "Paper",     desc: "Light",                     bg: "#f6f7f9", brand: "#0e7490", card: "#ffffff", text: "#16181d" },
];

// Forge, Forest and Plum were retired in the calm redesign (Oct 2026). A value
// saved in a browser, set via THEME, or written by the wizard that names one of
// them falls back to Midnight rather than an unstyled theme class.
export function normalizeTheme(t: unknown): ThemeKey {
  return THEMES.some(th => th.key === t) ? (t as ThemeKey) : "midnight";
}

// ── Timezone list ───────────────────────────────────────────────────────────

export const TIMEZONES = [
  "Pacific/Auckland", "Pacific/Fiji",
  "Australia/Sydney", "Australia/Adelaide", "Australia/Perth", "Australia/Hobart", "Australia/Brisbane",
  "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore",
  "Asia/Kolkata", "Asia/Dubai", "Asia/Karachi",
  "Europe/Moscow", "Europe/Istanbul", "Europe/Athens", "Europe/Helsinki",
  "Europe/Berlin", "Europe/Paris", "Europe/Amsterdam", "Europe/Zurich",
  "Europe/London",
  "Atlantic/Reykjavik",
  "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu",
  "America/Toronto", "America/Vancouver",
] as const;

// ── Service icon/port constants ─────────────────────────────────────────────

export const SVC_PORTS: Record<string, number> = {
  radarr: 30025, sonarr: 33027, bazarr: 30046, tautulli: 30047,
  qbittorrent: 30024, overseerr: 30002, nginx: 30020, pihole: 20720,
  prowlarr: 30050, uptimekuma: 31050, speedtest: 30220, prometheus: 30104,
};

// ── Service identity: colour, icon, display name ────────────────────────────
//
// These lived in four places. SVC_COLORS had three copies and two of them
// disagreed — ServicesPanel and ActivityFeed matched, DependencyMap assigned
// different hexes to the same nine services (radarr #f5c518 vs #ffc230, pihole
// #f60d1a vs #96060c, …), so a service visibly changed colour depending on
// which panel you were looking at. SVC_LABELS had two copies, the second
// carrying a "keep in sync with ServicesPanel" comment — which is the smell
// that prompted this.
//
// ServicesPanel's values are canonical: it's the primary surface and two of the
// three copies already agreed with it. DependencyMap's extra entries (plex,
// grafana, prometheus) are kept, since the others simply lacked them.

export const SVC_COLORS: Record<string, string> = {
  radarr: "#f5c518", sonarr: "#35c5f4", bazarr: "#4a90d9",
  tautulli: "#e5a00d", qbittorrent: "#2196f3", overseerr: "#e5a00d",
  pihole: "#f60d1a", prowlarr: "#ff8c00", nginx: "#2ecc71",
  uptimekuma: "#5cdd8b",
  // Referenced by the dependency graph, which can include services the
  // dashboard doesn't poll directly.
  plex: "#e5a00d", grafana: "#f97316", prometheus: "#e6522c",
};

export const SVC_ICONS: Record<string, string> = {
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

// Official brand casing. Without an entry, callers fall back to the raw
// lowercase route name.
export const SVC_LABELS: Record<string, string> = {
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
