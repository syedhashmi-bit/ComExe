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
