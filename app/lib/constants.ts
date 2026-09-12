// ── Shared constants ────────────────────────────────────────────────────────
// Single source of truth for data that's duplicated across page.tsx, setup/,
// and welcome/. Import from here instead of re-declaring.

// ── Theme definitions ───────────────────────────────────────────────────────

export type ThemeKey = "midnight" | "forge" | "forest" | "plum" | "paper";

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
  { key: "midnight", label: "Midnight",  desc: "Dark blue-black with cyan accents",      bg: "#0a0c12", brand: "#06b6d4", card: "#0e1117", text: "#e2e8f0" },
  { key: "forge",    label: "Forge",     desc: "Warm dark with amber accents",            bg: "#12100a", brand: "#f59e0b", card: "#1a1610", text: "#e2d9c5" },
  { key: "forest",   label: "Forest",    desc: "Deep green-black with emerald accents",   bg: "#080f0a", brand: "#10b981", card: "#0e1610", text: "#c5e2d0" },
  { key: "plum",     label: "Plum",      desc: "Purple-black with magenta accents",       bg: "#10081a", brand: "#d946ef", card: "#160e1e", text: "#d9c5e2" },
  { key: "paper",    label: "Paper",     desc: "Light theme with slate accents",           bg: "#f8fafc", brand: "#0284c7", card: "#ffffff", text: "#1e293b" },
];

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
