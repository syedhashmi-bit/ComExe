# CLAUDE.md

Guidance for Claude Code working in this repo. **`memory.md`** has past decisions and bug fixes; **`skills.md`** has reusable patterns; **`context.md`** has env-var/infra inventory.

## Build & deploy workflow

> **Important deviation from a normal Next.js setup:** the production build runs on the **PC**, not in the Docker image. The Dockerfile is runtime-only.

Background: `next build` SIGSEGVs non-deterministically inside Docker on the TrueNAS host (different crash points on different runs — confirmed not Alpine vs Debian, not memory, not standalone trace). Building on the PC and shipping the prebuilt `.next/` via git fully sidesteps it.

`/.next/` is checked into git (~1.6 MB / 97 files per build). `.next/cache` and `.next/trace` stay gitignored — they're regenerable and would bloat commits.

### Dev (PC)

```powershell
# PC (PowerShell) — npm is not on PATH by default
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
npm run dev      # localhost:3000 (falls back to :3001)
npm run build    # always run before push — produces .next/ that gets shipped
npm run lint     # optional
```

### Deploy

```powershell
# PC (PowerShell)
git add .next app/<your-changes>
git commit -m "..."
git push
```

```bash
# TrueNAS (bash)
/root/update-dashboard.sh
```

`update-dashboard.sh` does `git fetch && git reset --hard origin/main`, `docker build`, then `docker run` with all required `-e` env vars baked into the script.

## Architecture

Single-page Next.js 15 App Router dashboard. No DB, no auth, no state library. Entire UI is one `"use client"` component in `app/page.tsx` (~2100 lines).

### API routes (server-side proxies)

Five routes — all proxy from the browser to internal services to avoid CORS and keep credentials server-side. **All credentials read from `process.env.*` — none hardcoded.**

| File | Purpose | Backend |
|------|---------|---------|
| `app/api/metrics/route.ts` | Prometheus metrics | `${TRUENAS_IP}:30104` |
| `app/api/services/route.ts` | Homelab service health (10 services) | various ports on `${TRUENAS_IP}` |
| `app/api/speedtest/route.ts` | Speedtest history | `${TRUENAS_IP}:30220` |
| `app/api/weather/route.ts` | Weather (open-meteo) | api.open-meteo.com |
| `app/api/mikrotik/route.ts` | Router stats | `192.168.88.1` |
| `app/api/activity/route.ts` | Recent grabs / streams (Sonarr + Radarr + Tautulli history) | `${TRUENAS_IP}:33027 / :30025 / :30047` |

`metrics/route.ts` runs ~30 PromQL queries via `Promise.all`. **Destructuring order must stay in sync with the queries array** — positional. New queries get appended at the end to preserve order.

`services/route.ts` does `Promise.allSettled` over 10 service functions (radarr, sonarr, bazarr, tautulli, qbittorrent, overseerr, pihole, prowlarr, nginx, uptimekuma). Each function has a single primary fetch that must succeed, plus optional enrichment fetches (`apiFetchOpt` returns `null` instead of throwing) that fail individually without sinking the card. On any primary fetch failure the card falls back to `["—"]` via `checkReachable()`. 10s in-memory cache.

`ServiceResult` shape: `name, up, lines[], pct?, downCount?, queueItem?, queueItems?, streams?, health?, weekly?`. The new richer fields:
- `queueItems?: QueueItem[]` — top-3 active downloads (Radarr/Sonarr/qBit). Each has `title`, `pct`, optional `etaSec`. The legacy single `queueItem` is still emitted for back-compat.
- `health?: { warning, error }` — populated for Radarr/Sonarr/Prowlarr from their `/health` endpoints. Card renders an orange/red pill in the header when set.
- `weekly?: { plays?, topShow?, topUser? }` — populated for Tautulli when no streams active, from `cmd=get_home_stats&time_range=7` + `cmd=get_history&after=<7d>`.

Per-service enrichment:
- **Radarr**: library size = `sum(movie.sizeOnDisk)`; cutoff-unmet count from `/wanted/cutoff?pageSize=1` `totalRecords`.
- **Sonarr**: library size = `sum(series.statistics.sizeOnDisk)` (requires the default `includeStatistics=true` on `/series`).
- **qBit**: aggregate ratio = `sum(uploaded) / sum(downloaded)`. Active speeds always shown. Top-3 downloads sorted by progress descending.
- **PiHole**: top blocked domain from `/api/stats/top_domains?blocked=true&count=1`; active client count from `len(/api/stats/top_clients?count=99)`.

`speedtest/route.ts` tries `/api/speedtest/latest` (Mbps) and `/api/v1/results?take=5` (the latter requires `Bearer ${SPEEDTEST_API_KEY}`). **Never trigger tests** — SpeedTracker schedules them. Note: the two endpoints return different units; see `memory.md` → "Speedtest unit mismatch".

`mikrotik/route.ts` uses Basic auth via `MIKROTIK_USERNAME`/`MIKROTIK_PASSWORD`. Has 10s cache.

`weather/route.ts` → open-meteo, no auth, hardcoded lat/lon for Launceston, TAS.

`activity/route.ts` aggregates three history sources via `Promise.all`: Sonarr `/api/v3/history` filtered to `grabbed`/`downloadFolderImported`, Radarr `/api/v3/history` same filter, Tautulli `cmd=get_history`. Each source is independently try/catched — one failing returns `[]` rather than blanking the feed. 60s in-memory cache. Returns `{ events: ActivityEvent[], timestamp }` sorted newest-first, capped at 30 events.

### `app/page.tsx` — the frontend

All UI components live in this one file. Categories:

**Primitives** (~20 components):
`GaugeBar`, `Sparkline`, `MiniBarChart`, `DonutChart`, `ThreeSegmentDonut`, `RadialGauge`, `BigValue`, `LabeledBar`, `SubRow`, `StatRow`, `Card`, `StatusBanner`, `SettingsPanel`, `ServiceIcon`, `BookmarkItem`, `AnimatedNumber`, `TrendDelta`, `HeroStat`, `ActivityEventPill`, plus `animatedLine()` and `relativeAgo()` helpers.

**Feature components**:
`SpeedtestDualChart` (SVG), `SpeedtestBarChart` (Canvas + DPR + ResizeObserver), `GoogleSearch`, `MikrotikTab`, `GrafanaCard`, `ActivityFeed`.

**Polling intervals** (managed in `Dashboard` via `useEffect` + `setInterval`):

| Endpoint | Interval |
|----------|----------|
| `/api/metrics` | `settings.refreshInterval`s (default 10s) |
| `/api/services` | 10s |
| `/api/speedtest` | 300s |
| `/api/weather` | 600s |
| `/api/mikrotik` | 30s |
| `/api/activity` | 60s |
| Clock | 1s |

### Components — what to know

**`Card`** — shared shell for every metric card. New behavior since the polish pass:
- Top border replaced by a 3px gradient stripe (`color → 60% → 20%`) with a colored glow
- Background has a radial brand-color tint at the top (~8% opacity)
- Hover: -3px lift, brand-color drop shadow + inner ring
- Header has a small **status dot** that pulses green/amber/red based on `alertLevel` prop

**`AnimatedNumber`** — interpolates between value changes (~600ms ease-out cubic). Used by `animatedLine()` and `HeroStat`. Preserves comma separators and decimal precision from the source string.

**`animatedLine(line, keyPrefix)`** — parses any string like `"16,173 queries today"` and returns `React.ReactNode[]` where every numeric literal has been wrapped in `<AnimatedNumber>`. Use this whenever rendering pre-formatted stat strings.

**`HeroStat`** — splits `lines[0]` of a service into "leading number + rest" and renders the number large (19px bold) with the rest as small muted suffix. Used by every services-panel card.

**`TrendDelta`** — small ↑/↓ indicator next to a hero metric. Compares `current` against `history[history.length - lookback]`. Caller sets `goodDirection` ("up" or "down") so coloring matches intent. Has a built-in sanity guard: suppresses output if `|delta|/|current| > 5` (catches unit-mismatch bugs like the speedtest one).

**`Sparkline`** — used everywhere. Stronger gradient since the polish pass (`0.5 → 0`), soft glow path under the main line, stroke width 2.2.

**`MikrotikTab`** — calls `/api/mikrotik` server-side (NOT the router directly anymore — that hit CORS). Falls back to a static-info row if the route returns an error.

**`ActivityFeed`** — horizontal scrolling ticker just above the services panel. Pulls from `/api/activity`. Hover pauses the scroll. Empty state renders nothing. Uses the `tickerScroll` keyframe in `globals.css` (translates `0` → `-50%` over a duration scaled to event count). Events are duplicated in the rendered list so the loop is seamless. Toggle via `CARD_KEYS["activity"]` in Settings.

### Services panel — services rendering

Service cards render in two **categories** (`SVC_CATEGORIES` constant near top of page.tsx):

- **Media stack**: radarr, sonarr, bazarr, tautulli, qbittorrent, overseerr, prowlarr (7 cards)
- **Infrastructure**: pihole, nginx, uptimekuma (3 cards)

Each category has a header with an accent dot, divider line, and live up-count (turns green at 100%). Each card has:
- Brand-color gradient stripe at top (3px, with glow)
- Subtle radial brand-color background
- Status dot, optional health pill (`1 ERR` red / `1 WARN` amber), label, hero stat (lines[0] with big number), other lines
- Progress bars: top-3 queue items for Radarr/Sonarr/qBit (each with title, ETA pill, thin bar), live stream progress bars for Tautulli
- Click anywhere → opens that service's web UI in a new tab (URLs from `SVC_URLS` constant)

Cards within a category are **sorted by health priority** before render: down → error → warning → active (has queue/stream) → idle. Same-tier services preserve route-array order.

### Page layout

1. Fixed elements: 3px loading bar at very top + 2px cyan healthy line
2. Sticky frosted header (z-30): logo, uptime pill, weather pill, clock, status dot, TrueNAS/settings buttons
3. Main content: GoogleSearch → MikrotikTab → StatusBanner → 3-col metric grid → Speedtest (full width) → Services → Bookmarks → Footer

**Grid** (3-column on xl):
- Row 1: CPU · Memory · Filesystems
- Row 2: Network · GPU · Speedtest
- Row 3: System · Grafana (each col-span-1, leaves col-span-1 empty)

**Filesystems card** — overhauled. Hero (top): pool used / total + colored %. Below: per-mount rows sorted by usage % (fullest at top), each with a thin 4px bar and unified amber folder icon (no more rainbow icons).

**GPU card** — tertiary tier (clocks, fan, ENC/DEC) consolidated into a single divider-prefixed row of muted pills. ENC/DEC only render when at least one is nonzero.

## Env vars

Server-side only. **Never** prefix with `NEXT_PUBLIC_` (would expose to client bundle). All listed in `.env.local.example`.

Currently consumed:
- `TRUENAS_IP` (default `192.168.88.196`)
- `RADARR_API_KEY`, `SONARR_API_KEY`, `BAZARR_API_KEY`, `TAUTULLI_API_KEY`, `PROWLARR_API_KEY`, `OVERSEERR_API_KEY`
- `QBIT_USERNAME`, `QBIT_PASSWORD`
- `PIHOLE_PASSWORD`
- `NGINX_USERNAME`, `NGINX_PASSWORD`
- `UPTIME_KUMA_API_KEY`
- `MIKROTIK_USERNAME`, `MIKROTIK_PASSWORD`
- `SPEEDTEST_API_KEY`

Production values live in `/root/update-dashboard.sh` on TrueNAS, passed as `-e VAR=value` to `docker run`. **Never** hardcoded in source, never in the image.

## Hard rules

- Never trigger speedtests — SpeedTracker handles scheduling.
- No external chart libraries. Canvas or inline SVG only.
- Wrap external fetches in try/catch. Render `"—"` on failure, never crash.
- All external links open in `_blank`.
- `font-variant-numeric: tabular-nums` on all numeric displays.
- Mobile responsiveness is **not** required.
- **Run `npm run build` before every commit/push** — the prebuilt `.next/` ships in the commit.
- Never commit `.env.local` (gitignored).

## Styling conventions

- Background: `#0a0c12` + radial gradient overlay
- Cards: `rgba(255,255,255,0.04)` bg + radial brand-color tint, `border-radius: 14px`, padding 18px
- Card hover: `translateY(-3px)`, brand-color drop shadow, brand-color inner ring
- Card brand stripe: 3px gradient bar (full → 60% → 20% with glow)
- Card status dot: 1.5×1.5 px, pulses on `pulseDot` keyframe (defined in `globals.css`)
- Severity colors: ok `#10b981`, mid `#06b6d4`, warn `#f59e0b`, critical `#ef4444`
- Card accent assignments — **don't change without reason**:
  - CPU `#06b6d4`, Memory `#10b981`, Filesystems `#f59e0b`, Network `#3b82f6`
  - GPU `#ef4444` (dynamic via `gpuUtilColor`), Speedtest `#8b5cf6`
  - System `#d946ef`, Grafana `#f97316`
- Fonts: Inter (UI), JetBrains Mono (numbers — use `font-mono` or inline `fontFamily: "monospace"`)
- Inline `style` props for colors/sizes; Tailwind for layout/spacing/flex. No CSS modules, no styled-components.

## Domain knowledge

**Prometheus**: single instance at `${TRUENAS_IP}:30104`. GPU metrics use `nvidia_smi_*` names. Network device is `enp4s0`.

**Memory accounting**: TrueNAS ZFS ARC inflates raw `MemAvailable`. Use `MemTotal - MemAvailable - SReclaimable` as real-used. Thresholds: warn >85%, critical >95%.

**Filesystem filter**: only mounts under `/mnt/Pool/Media/` displayed. Exclude `tmpfs|devtmpfs|overlay|squashfs|ramfs` at PromQL via `FS_EXCLUDE`.

**GPU temp thresholds**: warn >80°C, critical >90°C.

**Service ports** — see `context.md` for the full table.

**Known CORS surfaces** — services that must be called via the server-side route, never directly from the browser:
- PiHole `:20720`, Bazarr `:30046`, qBittorrent `:30024` — server-side proxy in `services/route.ts`
- MikroTik `192.168.88.1` — server-side proxy in `mikrotik/route.ts`

## MCP tools available

- **Context7** — fetch latest library docs. Use before writing code that touches Next.js, React, Tailwind, Node, etc.
- **Playwright** — browser automation, useful for verifying UI changes after a build.

Use Context7 by default over WebFetch/WebSearch for library docs.

## Hashmi-homelab skill

`.claude/skills/Hashmi-homelab/SKILL.md` — workflow + style conventions (PC=PowerShell, TrueNAS=bash, concise direct prose, secrets via `-e` flags only). Apply on any task touching this repo, Docker on TrueNAS, MikroTik, or related services.

## Supplementary files

| File | Purpose |
|------|---------|
| `context.md` | Infra inventory — env var names, ports, hardware specs |
| `memory.md` | Past bug fixes and architectural decisions |
| `skills.md` | Reusable code patterns (PromQL queries, polling, primitives) |
| `.env.local.example` | Template for `.env.local` (gitignored) |

When `CLAUDE.md` conflicts with `skills.md` or `memory.md`, **CLAUDE.md wins** — those two are historical and may lag.
