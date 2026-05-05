# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

npm is at `C:\Program Files\nodejs\npm.cmd` — it is not on PATH by default in this environment.

```powershell
# Development
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
npm run dev      # starts dev server (localhost:3000, falls back to :3001 if occupied)
npm run build    # production build — always run to verify no TypeScript errors before finishing
npm run start    # production server (after build)
npm run lint     # ESLint check
```

Docker build (for TrueNAS SCALE / k3s deployment):
```bash
docker build -t truenas-dashboard .
docker run -p 3000:3000 truenas-dashboard
```

## Architecture

Single-page Next.js 15 App Router dashboard. No database, no auth, no external state management. The entire UI is one `"use client"` component in `app/page.tsx`.

### API routes (server-side proxies)

All four routes proxy requests from the browser to internal services — avoids CORS and keeps credentials server-side.

| File | Purpose | Backend |
|------|---------|---------|
| `app/api/metrics/route.ts` | Prometheus metrics | `192.168.88.196:30104` |
| `app/api/services/route.ts` | Homelab service health | Various ports on `192.168.88.196` |
| `app/api/speedtest/route.ts` | Speedtest history | `192.168.88.196:30220` |
| `app/api/weather/route.ts` | Weather data | open-meteo.com (lat: -41.4419, lon: 147.1450) |

**`app/api/metrics/route.ts`** — Runs ~20 PromQL queries in a single `Promise.all`. The destructuring order of the result array **must stay in sync** with the queries array — they are positional, not named. GPU utilization is converted from 0–1 ratio to 0–100 here.

**`app/api/services/route.ts`** — `ServiceResult` interface: `name`, `up`, `lines[]`, optional `pct` (radarr library completion %). Each service function does its own `Promise.all` for parallel sub-requests and falls back to `checkReachable()` on error — so services that fail auth/data fetch still show as "up" with "—" if the server responds at all.

**`app/api/speedtest/route.ts`** — Tries four endpoint shapes in order; uses the first that returns data. `extractArray()` handles `{data:[]}`, `{results:[]}`, `{data:{results:[]}}`, and single-item shapes. `normalizeMbps()` converts bps→Mbps if `>1_000_000`, kbps→Mbps if `>1_000`, else passes through. **Never trigger tests** — SpeedTracker handles scheduling.

### `app/page.tsx` — the entire frontend (~2100 lines)

All UI components are defined in this single file. Key components:

- **Primitive components**: `GaugeBar`, `Sparkline`, `MiniBarChart`, `DonutChart`, `ThreeSegmentDonut`, `BigValue`, `LabeledBar`, `SubRow`, `StatRow`
- **Feature components**: `SpeedtestDualChart` (SVG line chart), `SpeedtestBarChart` (canvas grouped bar chart), `GoogleSearch`, `MikrotikTab`, `ServiceIcon`, `BookmarkItem`
- **Layout components**: `Card`, `StatusBanner`, `SettingsPanel`

**Poll intervals** (all managed in the `Dashboard` component via `useEffect` + `setInterval`):
- `/api/metrics`: every `settings.refreshInterval` seconds (default 10s)
- `/api/services`: every **10 seconds**
- `/api/speedtest`: every 300 seconds
- `/api/weather`: every 600 seconds
- Clock: every 1 second

**Page layout structure:**
1. Fixed elements (z-50/z-40): loading progress bar + 2px cyan healthy-state line at top of viewport
2. Sticky frosted-glass header (z-30): `position: fixed`, `backdrop-filter: blur(12px)`, `rgba(10,12,20,0.9)` bg. Contains logo, uptime pill, weather pill, split date/time display, status dot, TrueNAS/settings buttons.
3. Main content (`paddingTop: 80` to clear the fixed header): GoogleSearch → MikrotikTab → StatusBanner → 3-col grid → Speedtest (full width) → Services → Bookmarks → Footer

**Grid layout (3-column):**
- Row 1: CPU · Memory · Filesystems
- Row 2: Network · GPU · System
- Row 3: Speedtest (lg:col-span-3)

**`MikrotikTab`** — Self-contained component. Fetches `http://192.168.88.1/rest/system/resource` client-side using Basic auth (`monitor-only:L03m1Tv0@3`). No server-side API route. On CORS failure (always expected in browser), renders a static hardcoded fallback: MikroTik hAP ax³ | RouterOS 7.22.1 | 192.168.88.1 | CPU: — | RAM: — | Uptime: 13d 4h. Both the live and fallback bars are `<a href="http://192.168.88.1">` — entire bar clickable.

**`SpeedtestBarChart`** — Canvas element with `devicePixelRatio` scaling. Uses a `ResizeObserver` inside `useEffect` to redraw when the container is properly laid out (fixes the "only 1 bar drawn" issue that occurs when canvas has zero dimensions on first mount). Tooltip `<div>` is mutated via `ref` directly (not React state) to avoid re-renders on every mouse move. The `results` prop (not a derived `data` array) is the effect dependency.

**`SpeedtestDualChart`** — SVG line chart; hover state uses React `useState`.

**`Sparkline`** — Uses `useId()` for unique SVG `linearGradient` IDs. Never remove this — multiple sparklines on the same page would share gradient colors otherwise.

**`GoogleSearch`** — Takes an `inputRef: React.RefObject<HTMLInputElement | null>` prop. The ref is created in `Dashboard` and also used by the keyboard handler to implement the G-key shortcut.

**`StatusBanner`** — healthy: renders `null` (the 2px cyan line is a separate fixed element); warning: 36px amber bar; critical: 48px red bar.

**`BOOKMARKS`** constant — each column now has an `accentColor` field used to color the column header dot and title.

**`CARD_KEYS`** — controls which cards appear in Settings visibility toggles. If adding a new card, add its key here.

**Dashboard state:**
- `showBookmarks` — toggled by H key, hides/shows the bookmarks section
- `searchInputRef` — `useRef<HTMLInputElement>` passed to `GoogleSearch`, focused by G key
- `clockDate` / `clockTime` — separate strings for the two-line clock display in the header
- `showHealth` — kept for backward compat but health line is always shown when healthy

**Keyboard shortcuts:** G = focus search, R = force-refresh metrics, H = toggle bookmarks, Escape = blur input / close settings.

## Key domain knowledge

**Prometheus endpoint**: All server metrics (CPU, memory, disk, network, GPU) come from a single Prometheus instance at `192.168.88.196:30104`. No separate GPU exporter — GPU metrics use `nvidia_smi_*` metric names.

**Network device**: `enp4s0` — used in all network Prometheus queries (`node_network_receive_bytes_total{device="enp4s0"}`).

**GPU metrics**: `nvidia_smi_utilization_gpu_ratio` (0–1, converted to % in route), `nvidia_smi_memory_used_bytes`, `nvidia_smi_memory_total_bytes`, `nvidia_smi_temperature_gpu` (°C), `nvidia_smi_power_draw_watts`, `nvidia_smi_power_limit_watts`. GPU name from `modelName` or `name` label on `nvidia_smi_gpu_info`.

**Memory alerting**: Uses `MemTotal - MemAvailable - SReclaimable` as real used — raw `MemAvailable` reads low on TrueNAS because ZFS ARC is counted as used but is reclaimable. Thresholds: >95% = critical, >85% = warning.

**Filesystem filter**: Only mountpoints under `/mnt/Pool/Media/` are shown. `tmpfs`, `devtmpfs`, `overlay`, `squashfs`, `ramfs` excluded at query level via `FS_EXCLUDE`.

**GPU temp thresholds**: warning >80°C, critical >90°C.

**Service ports** (all on `192.168.88.196`):
- Radarr :30025, Sonarr :33027, Bazarr :30046, Tautulli :30047
- qBittorrent :30024, Overseerr :30002, Nginx Proxy Manager :30020
- PiHole :20720, Prowlarr :30050, Speedtest :30220, Prometheus :30104
- Uptime Kuma :31050

**Known CORS failures** — these services are checked via server-side proxy or `checkReachable()` fallback; never call them directly from the browser:
- PiHole API at :20720
- Bazarr API at :30046
- qBittorrent API at :30024
- MikroTik REST API at 192.168.88.1 (client-side only, always CORS-blocked — use hardcoded fallback)

## Hard rules

- **Never trigger speedtests** — SpeedTracker handles scheduling; only fetch existing results.
- **No external chart libraries** — use Canvas or inline SVG only.
- **All fetches wrapped in try/catch** — show "—" on failure, never crash.
- **All external links** open in `_blank`.
- Mobile responsiveness is not required.

## Styling conventions

- **Fonts**: Inter (UI text) + JetBrains Mono (numeric values only — use `font-mono` class or `fontFamily: "monospace"` inline). Both imported in `globals.css` via Google Fonts.
- **Background**: `#0a0c12` + `radial-gradient(ellipse at 50% 0%, rgba(30,40,80,0.35) 0%, transparent 65%)` on `<main>`.
- **Card style**: `rgba(255,255,255,0.04)` bg, `rgba(255,255,255,0.08)` border, `blur(6px)` backdrop-filter, `border-radius: 14px`, `padding: 18px`, hover `translateY(-2px)` + `rgba(255,255,255,0.15)` border.
- **Card accent colors**: CPU `#06b6d4`, Memory `#10b981`, Filesystems `#f59e0b`, Network `#3b82f6`, GPU `#ef4444` (dynamic via `gpuUtilColor`), Speedtest `#8b5cf6`, System `#d946ef`.
- **Progress bar track**: `rgba(255,255,255,0.08)`, height 5px (3px thin variant). Severity colors: `#10b981` ok, `#06b6d4` mid, `#f59e0b` warn, `#ef4444` critical.
- **Text palette**: primary `#ffffff`, secondary `rgba(255,255,255,0.65)`, muted `rgba(255,255,255,0.45)`, very muted `rgba(255,255,255,0.25)`.
- **Pills** (header): `rgba(255,255,255,0.08)` bg, `rgba(255,255,255,0.12)` border, `border-radius: 6px`, `padding: 3px 10px`, `font-size: 11px`.
- **Status dot animation**: `pulseDot 2s ease-in-out infinite` keyframe defined in `globals.css`.
- **Card load animation**: `fadeSlideIn 0.45s ease both` keyframe in `globals.css`, staggered via `animationDelay` prop on `Card`.
- Inline `style` props for colors/sizes; Tailwind for layout/spacing/flex. No CSS modules, no styled-components.
- `font-variant-numeric: tabular-nums` on all numeric displays to prevent layout shift.

## Supplementary files

- `context.md` — infrastructure IPs, hardware specs, service API keys/credentials
- `skills.md` — historical coding patterns (may be outdated; CLAUDE.md is authoritative)
- `memory.md` — past bug fixes and decisions (may be outdated; CLAUDE.md is authoritative)
