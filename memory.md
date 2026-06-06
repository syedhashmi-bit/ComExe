# Project Memory

Past decisions and bug fixes. **`CLAUDE.md` is authoritative** — when this file conflicts with it, CLAUDE.md wins.

## Architecture decisions

### Server-side API routes (current)

**Decision:** Use Next.js App Router API routes (`app/api/*/route.ts`) as server-side proxies for all external service calls.
**Why:** Avoids CORS, keeps creds off the client, allows `Promise.all` fan-out and 10s in-memory caching.

### Five active routes

- `app/api/metrics/route.ts` — Prometheus, `Promise.all` of ~30 PromQL queries. **Positional destructure must stay in sync with the queries array** — new queries get appended at end.
- `app/api/services/route.ts` — 10 services via `Promise.allSettled`. `checkReachable()` fallback so failed-auth services still show "up" with `"—"`.
- `app/api/speedtest/route.ts` — SpeedTracker history. **Read-only — never trigger tests.**
- `app/api/weather/route.ts` — Open-Meteo (Launceston, TAS).
- `app/api/mikrotik/route.ts` — server-side proxy with Basic auth. The `MikrotikTab` client component now fetches `/api/mikrotik`, NOT the router directly.

### Build moved off Docker (initial workaround)

`next build` SIGSEGVs non-deterministically inside the Docker build on the TrueNAS host. Ruled out:
- Alpine vs Debian (tried both)
- Memory exhaustion (tried `--max-old-space-size=4096`, OOMKilled=false)
- `webpackMemoryOptimizations` (tried, still crashed)
- Standalone-output trace (tried removing, still crashed at "Generating static pages 9/9" then SIGSEGV)
- `set +e` + artifact-check workaround (artifacts incomplete because the crash sometimes happens earlier)

Crash point varies between runs (page-data-collection, post-static-page, post-trace), strongly suggesting CPU/cgroup interaction with Next 15's SWC binary that can't be fixed from inside the repo.

**First fix (interim):** build `.next/` on the PC, ship via git, runtime-only Dockerfile on TrueNAS. Worked but coupled the deploy to local PC builds.

### Build → CI on GitHub Actions (current)

Once we externalized config and started publishing a public image, the natural fix to the SIGSEGV was to move the build out of TrueNAS Docker entirely. CI (`.github/workflows/build.yml`) runs on Ubuntu x86_64 — different hardware than the user's TrueNAS — and `next build` works reliably there.

- Dockerfile is back to a normal multi-stage build (`deps → builder → runner`).
- Image is pushed to `ghcr.io/syedhashmi-bit/comexe:latest` on every push to `main`. Also tagged with `:sha-<short>` and `:v<x.y.z>` for tagged releases. (Pre-rename it lived at `ghcr.io/syedhashmi-bit/homelab-dashboard:latest` — that path is now frozen at the last build before the rename.)
- TrueNAS `update-dashboard.sh` is now `docker pull` + `docker stop/rm/run`. No git pull, no docker build.
- `.next/` removed from git — it's built fresh inside the image during CI.

### Externalized infrastructure config (shareable image)

To make the dashboard installable on someone else's TrueNAS, all hardcoded infra values were moved to env vars (with defaults that match the original deployment for back-compat):

- Per-service URLs (`RADARR_URL`, `SONARR_URL`, etc.) — default to `${TRUENAS_IP}:<port>`
- `MIKROTIK_URL` — default `http://192.168.88.1`
- `FS_PATH_PREFIX`, `POOL_PATH`, `NETWORK_DEVICE_EXCLUDE`
- `WEATHER_LAT`, `WEATHER_LON`
- `GRAFANA_BASE_URL` + `GRAFANA_DASHBOARD_UID` + `GRAFANA_DATASOURCE_UID` + `GRAFANA_PANEL_ID` + `GRAFANA_DASHBOARD_SLUG` (no defaults for the UIDs — embed renders "not configured" when missing)

Bookmarks moved out of `app/page.tsx` into a JSON file (`bookmarks.json`) read at runtime by `/api/config`. Path overridable via `BOOKMARKS_PATH`. Default location is `cwd/bookmarks.json` ⇒ `/app/bookmarks.json` inside the image.

Client-side runtime config is exposed through a new `/api/config` route. The client fetches it once on mount and uses the response for `BOOKMARKS`, `SVC_URLS`, Grafana embed URL, and the MikroTik href. Nothing in `/api/config` is a secret.

### Secrets migration (Apr/May 2026)

All hardcoded secrets in `app/api/*/route.ts` moved to `process.env.*`. Old hardcoded values were also scrubbed from git history via three `git filter-repo` passes (blobs + commit messages):

- Pass 1: 11 listed credentials (Radarr/Sonarr/Bazarr/Tautulli/Overseerr/Prowlarr/Uptime-Kuma keys, Speedtest bearer, qBit & MikroTik passwords, PiHole token)
- Pass 2: 3 more (PiHole API password, NPM password, contact email)
- All 14 patterns confirmed gone via `git log --all -p | grep -E ...` returning 0 matches

Old commit SHAs are dead. Force-pushed to `main`. Anyone who pulled before the rewrite still has the originals — credentials were rotated on each affected service after the scrub.

**The `the user's git author email` author email** still appears on every commit's author/committer field (`--replace-text` and `--replace-message` don't touch authorship). That's a separate `--email-callback` operation, not done.

### Runtime config store + Save & apply (current)

**Decision:** Config resolution centralized into a server-only `loadConfig()` that merges three layers, highest precedence first:
1. `data/config.json` — written by the `/setup` wizard via POST `/api/config`
2. `process.env.*`    — set via `docker run -e`
3. baked-in defaults

**Why:** Before this, the `/setup` wizard could TEST credentials but had no way to APPLY them — it generated a docker-compose snippet for the user to copy and redeploy. That's friction the project doesn't need on first install. With the file layer, "Save & apply" writes to a mounted volume and the next request to any service route picks up the change within ~3 seconds. No restart, no redeploy.

**Where it lives:** `app/lib/server-config.ts`. The `services/route.ts`, `mikrotik/route.ts`, and `activity/route.ts` handlers were refactored to take resolved `ServiceCreds` as a parameter from a single `loadConfig()` call at the top of `GET()`. `metrics/route.ts` and `weather/route.ts` still read env vars directly — they don't have user-facing config the wizard touches.

**Security:** The POST `/api/config` endpoint has no auth. Anyone with browser access to the dashboard can write config. That's an acceptable LAN homelab assumption; flagged in INSTALL.md and the wizard's security note. Don't expose the dashboard publicly without a reverse proxy doing auth.

### Setup wizard at `/setup` (current)

Single-page React form. Per-service rows with auth-shape-aware fields (apikey / userpass / password / bearer). Each row has a **Test** button that POSTs to `/api/test-connection` — that endpoint actually authenticates against the upstream and returns concrete error messages.

Form state mirrors to `localStorage` (`comexe:setup-wizard`) so refresh doesn't lose progress. **Save & apply** button is the primary action; if the writable volume isn't mounted (`writable: false` from `/api/config` GET), the button is disabled with an amber warning showing the exact mount line to add. The legacy "copy this docker-compose.yml" three-tab output is hidden behind a "Show generated config" toggle as a fallback.

### First-run UX cleanup (current)

- Service cards for upstream services with missing credential env vars are HIDDEN from the visible grid (used to show as `—` placeholders, which read as "broken").
- Each `ServiceResult` now carries `configured: boolean` and `envVar?: string[]` so the frontend knows which to hide and which env vars are missing.
- A friendly setup banner appears between the MikroTik bar and the metric grid when fewer than 3 services are configured, pointing at `/setup`.
- Settings panel gained a **Connections** section listing every service with a colored-dot status (`● connected` / `● unreachable` / `● not configured`), plus a "Missing env vars" copy-paste reference block.

### Brand: ComExe (current)

Renamed end-to-end:
- GitHub repo: `syedhashmi-bit/homelab-dashboard` → `syedhashmi-bit/ComExe` (GitHub auto-redirects the old URL, including for `git clone` / `raw.githubusercontent.com`).
- GHCR image: `ghcr.io/syedhashmi-bit/homelab-dashboard:latest` → `ghcr.io/syedhashmi-bit/comexe:latest` (lowercase — GHCR/Docker requirement; `docker/metadata-action` lowercases automatically).
- Container / app name (compose service, `--name`): `homelab-dashboard` → `comexe`.
- localStorage key: `homelab-dashboard:setup-wizard` → `comexe:setup-wizard` (one-time blip; existing wizard state is invalidated).
- All in-repo references updated: `INSTALL.md`, `README.md`, `docker-compose.example.yml`, the wizard's generated config (`app/setup/page.tsx`), and the GitHub link in `app/page.tsx`.

**Breaking-change note:** The GHCR image at the old path is frozen at the last pre-rename build. Anyone still running `docker pull ghcr.io/syedhashmi-bit/homelab-dashboard:latest` (e.g. an unmodified `update-dashboard.sh` on TrueNAS) won't get new builds. Update the script to pull from `ghcr.io/syedhashmi-bit/comexe:latest`.

Icon at `app/icon.svg` (Next.js auto-serves as favicon). Minimalist letterform: open half-arc C on the left + bare 3-bar E on the right, both in cyan `#06b6d4`, single 2.6px stroke, rounded caps, no fills, no background plate. Same SVG embedded inline in the dashboard's header next to the wordmark "Com**Exe**".

### Next 16 + ESLint flat-config upgrade (Jun 6 2026)

Resolved the cluster of stuck Dependabot major PRs. Landed in two commits: `next lint` → flat-config CLI migration (#11), then the combined framework major (#12: `next` 15.5.19 → 16.2.7 + `eslint-config-next` 15.5.19 → 16.2.7).

- **Why combined:** `eslint-config-next` 16 ships a *native* flat-config array and won't work through `FlatCompat`; landing it required the Next 16 bump and the flat-config switch together. PRs #8 (Next 16) and #10 (config-next 16) were interlocked and red on their own — superseded by #12 (auto-closed).
- **`eslint.config.mjs`:** dropped `FlatCompat`/`@eslint/eslintrc`; spreads `eslint-config-next/core-web-vitals` (native array). Pins `settings.react.version` to `"19.2"` so `eslint-plugin-react` skips its filesystem auto-detection (and pre-empts the ESLint 10 crash).
- **react-hooks 7 (React Compiler ruleset):** config-next 16 bundles `eslint-plugin-react-hooks@7`, which adds 3 rules absent under config-next 15 — `set-state-in-effect`, `purity`, `refs`. They flag ~22 long-standing intentional patterns (polling effects, `setMounted` hydration guards, `Date.now()` in render). **Downgraded to `warn`** in `eslint.config.mjs` so the bump stays behaviour-preserving; the real fix is a dedicated React-Compiler pass. Lint is now 0 errors / 26 warnings (incl. the 4 pre-existing `<img>` ones); warnings don't fail CI (no `--max-warnings`).
- **ESLint 10 held (#9):** ESLint 10.4.1 crashes the plugin versions config-next 16 pins — `eslint-plugin-react@7.37` calls the removed `context.getFilename()`, and the typescript-eslint parser path hits `scopeManager.addGlobals is not a function`. Their peer is still `eslint: >=9` and they target 9. **Stayed on ESLint 9.** Revisit when those plugins ship ESLint 10 support.
- **Tailwind v4 held (#7):** still on v3; needs a deliberate migration (`@tailwindcss/postcss` + visual-regression check), not a blind bump.
- **`middleware.ts` → `proxy.ts`:** Next 16 deprecates the `middleware` file convention. Renamed the file and the exported fn `middleware` → `proxy`. **Proxy runs on the nodejs runtime, not edge** — fine here (we only do lightweight cookie checks; auth logic unchanged). `config.matcher` unchanged.
- **Auto-migrations Next 16 wrote:** `next-env.d.ts` (reference → import form), `tsconfig.json` (`jsx: preserve` → `react-jsx`, added `.next/dev/types` to includes). Committed as-is.
- **Gotcha — PR CI doesn't build:** `test.yml` (the PR `unit` gate) runs lint+tsc+test only, **not** `npm run build`. For framework majors, verify `npm run build` locally — `build.yml` only runs the real Docker build on push-to-main. All four (lint, tsc, 53 tests, build) verified green locally before merge.
- **CI hygiene follow-ups (`1d390a3`):** added `paths-ignore: ["**.md"]` to `build.yml`'s push trigger so docs-only commits stop rebuilding/republishing the GHCR image; bumped `docker/setup-qemu-action@v3 → @v4` (clears the Node-20 deprecation). Other actions already current. Verified green.

### Deployment posture: LAN-only, never internet-exposed (Jun 6 2026)

User confirmed ComExe stays **LAN-only** — no Cloudflare Tunnel, no internet exposure planned. This **retires the auth + key-rotation security items**: `DASHBOARD_PASSWORD` / `AUTH_PROXY_HEADER` stay off (fine for a flat trusted LAN), and the two API keys that leaked into chat earlier (Prowlarr, qBit) don't need rotating since there's no internet attack surface. The auth machinery still exists (`proxy.ts` + login flow) if the posture ever changes — re-flag rotation + enabling auth *before* any future exposure. Roadmap phase-plan Part A item 4 (security hardening) is correspondingly lower priority while LAN-only holds.

## Known CORS / quirks

| Service | Symptom | Handled by |
|---------|---------|------------|
| MikroTik (`192.168.88.1`) | CORS-blocked from browser | Proxied via `/api/mikrotik` server-side route |
| PiHole (`:20720`) | CORS + v6 two-step auth | `services/route.ts` → password POST → SID, cached |
| Bazarr (`:30046`) | CORS | Server-side, `X-API-KEY` header |
| qBittorrent (`:30024`) | CORS + cookie SID auth + IP ban after 5 failed logins | Server-side login then `Cookie: SID=…` + `Referer` header |

## Component patterns introduced

### Animated numbers (`AnimatedNumber` + `animatedLine` helper)

Wraps numeric literals in stat strings with smoothly-interpolated values (~600ms ease-out cubic). Caller uses `animatedLine("16,173 queries today", "key")` and gets back `React.ReactNode[]` ready to render. Preserves comma separators and decimal precision automatically.

### Hero stat (`HeroStat`)

Splits `lines[0]` of a service result into "leading number + rest". Renders the number at 19px bold and the rest as small muted suffix. Used by every services-panel card to give the eye an obvious anchor per card.

### Trend delta (`TrendDelta`)

Compares `current` to `history[length - lookback]` (default lookback 6 = ~60s at 10s polling). Renders `↑ X` / `↓ X` colored green/red based on `goodDirection`.

**Built-in sanity guard:** suppresses output if `|delta|/|current| > 5`. This catches unit-mismatch bugs — see "Speedtest TrendDelta" below for why this matters.

Currently used on: CPU %, Memory pressure %, GPU temp.

### Card status dot

Every `<Card>` header now has a small pulsing dot (right side, before expand arrow) keyed off `alertLevel`:
- green pulse — healthy
- amber pulse — warning
- red pulse — critical

Lets you scan the whole dashboard for trouble at a glance.

### Card visual treatment

- 3px gradient accent stripe at top (`color → 60% → 20%`) with colored glow
- Subtle radial brand-color background (~8% at top)
- Hover: -3px lift, brand-color drop shadow, brand-color inner ring

Same treatment on services-panel cards (in-place divs) and metric cards (via `Card` primitive). Keeps both sections feeling like the same design.

## Bug fixes log (chronological)

### Speedtest TrendDelta unit mismatch (May 8 2026)

Speedtest card was rendering `↓ 69,801,868` next to a 920 Mbps download. Cause: `/api/speedtest/latest` returns Mbps but `/api/v1/results?take=5` (the source for `speedtestHistory`) returns bits/sec on this SpeedTracker version. Fix:
- Removed the speedtest-specific `<TrendDelta>` (5-min polling makes the delta low-value anyway)
- Added a sanity guard inside `TrendDelta`: if `|delta|/|current| > 5`, treat as unit mismatch and render nothing

### Grafana app keeps stopping (May 8 2026)

`docker logs ix-grafana-grafana-1` showed `fatal error: fault` (Go runtime SIGBUS on mmap'd file). Bleve search index was corrupted. User opted to delete + reinstall the app (lost dashboards). After reinstall:
- Datasource UID changed from `bfkupt1hj588wa` to `cflfv1hjeg9vka` — ComExe's `GRAFANA_PANEL` URL had to be updated
- Iframe wouldn't render until `GF_SECURITY_ALLOW_EMBEDDING=true`, `GF_AUTH_ANONYMOUS_ENABLED=true`, `GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer` were added to the Grafana app's env vars (defaults block all framing)

### qBittorrent IP ban during deploy iteration (May 8 2026)

After 5 wrong-password attempts, qBit bans the source IP for 1 hour. Fix is `docker restart $(docker ps --filter "name=qbittorrent" -q)` to clear the in-memory ban list. **Always test creds with curl before redeploying** to avoid burning through the failed-attempt budget.

### Service auth fixes (commits `0232c2c` → `c87954f`)

- **PiHole v6** — two-step auth: POST password → get SID → use SID. Token cached in module scope.
- **qBittorrent** — `Referer: http://192.168.88.196:30024` header required on `/api/v2/auth/login`. Extract `SID` from `Set-Cookie`. Use `stalledUP` state for completed-but-seeding torrents.
- **Bazarr** — `X-API-KEY` header (capital K). Root totals come from `/api/system/status`.
- **MikroTik** — Basic auth with credentials URL-encoded (passwords with `$`/`@`/`!` need single-quoting in `docker run -e`).
- **Uptime Kuma** — slug-based monitor lookup (not numeric id); fall back to parsing `/metrics` endpoint when `/api/status-page/heartbeat/<slug>` returns nothing.

### Speedtest history endpoints (commits `ee4f4e1` → `1e19322`)

Tried 3 endpoint shapes; settled on `/api/v1/results?take=N` with Bearer auth. v1 API has `download_bits` (raw) and `download` (varies in unit) — see "Speedtest TrendDelta" above.

### Caching + reliability (`15485b8`)

- 10s in-memory cache (module-level `Map`) on `services`, `metrics`, `mikrotik` routes
- `Promise.allSettled` so one failed service doesn't blank the panel

### Initial scaffolding fixes

- `autoprefixer` missing → `npm install autoprefixer postcss tailwindcss`
- PowerShell exec policy → `Set-ExecutionPolicy RemoteSigned`
- Broken mikrotik route was `route.js` in TS project — deleted, recreated as `.ts`
- GPU showing wrong values → wrong unit conversions (see GPU section in CLAUDE.md)
- Filesystem showing all mounts → filtered to `/mnt/Pool/Media/` only

## GPU metrics conversions (reference)

- `nvidia_smi_utilization_gpu_ratio` → 0–1, **multiply by 100** for %
- `nvidia_smi_temperature_gpu` → already °C
- `nvidia_smi_memory_used_bytes` / `_total_bytes` → divide by `1073741824` for GB
- `nvidia_smi_power_draw_watts` / `_limit_watts` → already watts
- Thresholds: temp warn `>80°C`, critical `>90°C`

GPU exporter: `utkuozdemir/nvidia_gpu_exporter:1.2.0` on port `9835`.

## Memory accounting

ZFS ARC counts as "used" but is reclaimable. Use `MemTotal - MemAvailable - SReclaimable` as real-used. Thresholds: warn `>85%`, critical `>95%`. Donut shows total-with-cache, banner uses real-only.

## Filesystem filter

Only `/mnt/Pool/Media/*` mounts shown. Excluded fstypes (at PromQL): `tmpfs`, `devtmpfs`, `overlay`, `squashfs`, `ramfs`.

## Prometheus container

- Container ID: `8fe9924cfe12`
- Config path: `/mnt/.ix-apps/app_mounts/prometheus/config/prometheus.yml`
- Reload after config edit: `docker restart 8fe9924cfe12` (run on TrueNAS)

## Open issues / tech debt

- **Author email scrubbing**: `the user's git author email` still appears on every commit's author field. Cleaning it requires `git filter-repo --email-callback` which rewrites authorship of every commit. Not done — most people consider git author email semi-public anyway.
- **Speedtest TrendDelta**: removed because of the unit mismatch. Could be added back if the route normalizes both endpoints to Mbps before returning.
- **GitHub PAT in `.git/config`**: `https://ghp_…@github.com/...` URL stores the token in plaintext. Local-only (not pushed) but consider switching to SSH or the Windows credential helper.
