# CLAUDE.md

Guidance for Claude Code working in this repo.

> **Doc precedence:** This file is the map. `memory.md` records past bug fixes and
> decisions, `skills.md` has reusable code patterns, `context.md` is the infra
> inventory (ports, hardware, env names), `ROADMAP.md` is effectively a changelog
> of shipped tiers plus a short open-work list at the very bottom. When any of
> them conflicts with the actual source, **the source wins** — verify before you
> rely on a doc claim. When they conflict with each other, prefer this file.

> **Branding:** The product name is **ComExe** end-to-end. GitHub repo:
> `syedhashmi-bit/ComExe`. GHCR image: `ghcr.io/syedhashmi-bit/comexe:latest`
> (lowercase — GHCR requirement). Container/app name: `comexe`. The old
> `homelab-dashboard` repo URL still redirects, but the GHCR image at the old
> path is frozen — every new build goes to the new path.

---

## What this is

A single-user, LAN-only homelab dashboard for a TrueNAS Scale host. Next.js 16
(App Router) + React 19 + Tailwind 3. No database, no ORM, no state library, no
chart library. Every upstream service is reached through a server-side route so
credentials never enter the browser bundle.

**Scale:** ~15k lines of TS/TSX under `app/` — 33 API routes, 29 components,
26 lib modules, 7 pages.

**Deployment posture:** one LAN, one user, never exposed to the internet. That
decision is why auth is optional, why RBAC/multi-user was dropped, and why the
Docker-socket routes are env-gated rather than fully sandboxed. If the
deployment model ever changes, that reasoning has to be revisited first.

---

## Build & deploy workflow

The production image is built by **GitHub Actions on push to `main`** and
published to **`ghcr.io/syedhashmi-bit/comexe:latest`**. TrueNAS deploys via
`docker pull`, never builds locally — that historically SIGSEGV'd on this host
(`memory.md` → "Build moved off Docker"). CI builds on Ubuntu runners, which
don't hit it.

### Dev (PC)

```powershell
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
npm run dev        # localhost:3000
npm run build      # local sanity check; CI does the real build
npm run lint
npm test           # vitest, 263 unit tests
npm run test:e2e   # playwright
npm run storybook  # primitives sandbox on :6006
```

Append `?demo=1` to any dashboard URL for realistic fake data with zero upstream
calls — see `app/lib/demo-data.ts`. Useful for UI work without a live homelab.

### Deploy

```powershell
git add app/<your-changes>
git commit -m "..."
git push
```

```bash
/root/update-dashboard.sh
```

`scripts/update-dashboard.sh` is the canonical version of that script — copy it
to `/root/` on TrueNAS. It is **health-gated**: pulls the new image, starts it
as a candidate container on a spare port, waits for the Docker `HEALTHCHECK` to
report healthy, and only then promotes it. A failed candidate leaves the running
container untouched and exits non-zero. The previous image is retagged
`:rollback` before every pull. With `--network host` the promotion is a brief
stop/start, not a true zero-downtime cutover — the win is that a broken image
never replaces a working one.

**CI gates:** `build.yml` runs lint + `tsc --noEmit` + tests as a `quality` job
and only publishes the image if all three pass. Multi-arch (amd64 + arm64).
`paths-ignore: ["**.md"]` means docs-only commits never republish — `/api/version`
knows about this and won't show a phantom "update available".

`.next/` is gitignored — built fresh inside the image during CI.

---

## Architecture

### Data transport — SSE first, polling as fallback

**`/api/stream` (SSE) is the primary transport.** The browser opens one
EventSource; the server fans out to the six data endpoints on independent
timers and pushes named events (`metrics`, `services`, `mikrotik`, `activity`,
`speedtest`, `weather`, plus `connected`/`heartbeat`).

`app/hooks/useEventStream.ts` manages it. On error it reconnects with backoff —
10s, then 20s — and on the **third** error sets `fallback: true`, at which point
`page.tsx` switches to per-endpoint `setInterval` polling. Both paths must keep
working; don't optimize one away. (The backoff formula has a 60s cap that is
unreachable in practice, since the retry counter never gets past 2 before
fallback trips. Harmless, but don't read the cap as the real ceiling.)

Interval defaults and **hard floors** live in `app/api/stream/route.ts`:

| Endpoint | SSE default | Floor |
|----------|-------------|-------|
| metrics | 10s | 5s |
| services | 30s | 20s |
| mikrotik | 15s | 10s |
| activity | 120s | 60s |
| speedtest | 600s | 120s |
| weather | 600s | 60s |

The floors exist because user overrides used to be able to flood the homelab.
Never remove them. (Note: the polling-fallback path in `page.tsx` uses slightly
tighter defaults for speedtest (300s) and activity (60s) than the SSE path —
harmless drift, but don't widen it.)

### The load story — read this before touching any fetch

The original 3s polling fired ~20 upstream calls/sec and repeatedly **crashed
the *arr containers and PiHole** on this host. Four independent layers now
prevent that, and every one of them matters:

1. **`app/lib/fetch-agent.ts`** — process-wide undici dispatcher capped at
   **2 concurrent sockets per origin**. Auto-installs on import. Means no
   regression anywhere can open a connection storm.
2. **`app/lib/circuit-breaker.ts`** — per-origin breaker. 5 consecutive
   failures opens the circuit; cooldown backs off 30s → 5min. One probe is let
   through (half-open); success closes, failure re-opens longer. Trips on 5xx
   and network errors but **deliberately not on 4xx** — a bad API key means the
   upstream is healthy and answering. Now covers every upstream call including
   `lib/services.ts` — for a long time it didn't, which meant the breaker
   didn't protect the *arr stack whose crashes motivated it.
3. **Per-endpoint memoization** in `lib/services.ts` — heavy library calls
   (`radarr/movies`, `sonarr/series`) cached 5min, enrichment 3–5min. Only
   genuinely real-time data (queue items, active streams, qBit speeds) is
   fetched fresh each cycle. This is the real load-killer: ~150 calls/hour per
   upstream instead of 1800+.
4. **Staged batching** — `lib/services.ts` splits its 10 upstream fetches into
   2 batches of 5 with a 250ms gap, avoiding a thundering herd.

Plus a per-service last-known-good cache (60s) that keeps cards populated across
brief failures, flagged `stale: true`.

### Background collector — alerts and history with no tab open

`instrumentation.ts` starts `lib/collector.ts` once per server process. It
exists because alerts used to be evaluated only when a browser tab POSTed its
data to `/api/alerts`, and `history.jsonl` was only appended when something
requested `/api/metrics`. With the tab closed or hidden (polling pauses then),
webhooks never fired and `/forecast` filled with gaps.

- **Idle** (no `/api/stream` clients): polls `getMetrics()` every 30s and
  `getServicesFresh()` every 60s, then runs `evaluateAndDispatch()`.
- **Active** (≥1 SSE client): makes **no** upstream calls. The SSE self-fetches
  already poll, so the collector just evaluates alerts against
  `peekMetrics()`/`peekServices()` every 10s.
- Fires go out on `collectorEvents` → `/api/stream` relays them as `event:
  alert` → `page.tsx` counts them and raises browser notifications. Webhooks
  are the always-on channel; browser notifications only reach a connected tab.
- On SIGTERM/SIGINT it emits `shutdown`, which closes open SSE streams so they
  don't hold Next's drain open, and waits for pending `alerts.json` writes.
- `COMEXE_COLLECTOR=0` disables it (the e2e suite does). Status is reported
  under `collector` in `/api/diagnostics`.

> **Shared state must go through `lib/singleton.ts`.** Next compiles
> `instrumentation.ts` separately from the route handlers, so a module-level
> `let cache` can exist twice in one process. Anything the collector and the
> routes both touch — the metrics/services caches, the circuit breaker's origin
> map, the collector's client counter and emitter — lives on `globalThis` via
> `globalSingleton(key, factory)`. A new module-level cache that the collector
> reads needs the same treatment, or it silently doubles upstream load. Unit
> tests must call `resetGlobalSingletons()` (`tests/unit/helpers/`), since
> `vi.resetModules()` doesn't clear `globalThis`.

### Shared lib modules — use these, don't re-roll them

Each of these exists because the pattern had been copy-pasted across many routes
and drifted. Reach for them before writing a new one.

| Module | Use for |
|--------|---------|
| `lib/http.ts` | **All outbound HTTP.** `fetchWithTimeout` (raw Response, throws) / `fetchJson` (parsed or `null`). Installs the undici agent and runs the circuit breaker. Default timeout 5s. |
| `lib/cache.ts` | `createTTLCache` (single value) / `createKeyedTTLCache` (per-key, size-capped). Replaced ~15 hand-rolled `{data, ts}` objects. |
| `lib/json-store.ts` | Anything persisted under `data/`. `createJsonStore(file, fallback)` → `read`/`write`/`tryWrite`. Atomic temp-file + rename. Exports `DATA_DIR`/`dataPath`. |
| `lib/prometheus.ts` | `promScalar(base, query)` / `promVector(base, query)`. Keeps the brittle `data.result[0].value[1]` shape knowledge in one place. |
| `lib/validate.ts` | `isNonEmptyString` / `isHttpUrl`. Required on every write route that persists client JSON or fetches a client-supplied URL. |
| `lib/server-config.ts` | `loadConfig()` — see below. |
| `lib/formatters.ts` | `fmtBytes`, `fmtTemp`, `fmtUptime`, `fmtPct`, `barColor`, `tempColor`, `normalizeSpeedResult`, … Pure, no React. |
| `lib/alerts.ts` | Pure threshold → `AlertLevel` functions + `computeHealth`. |
| `lib/types.ts` | All shared types. Types only, no runtime code. |

`lib/server-config.ts`, `lib/history.ts`, `lib/custom-cards.ts`, `lib/docker.ts`,
`lib/auth.ts`, `lib/json-store.ts` are **server-only** — importing any of them
from a `"use client"` module breaks the bundle.

### Config resolution — `app/lib/server-config.ts`

Single source of truth for "what URL / key / password for service X right now?".
Three layers, highest precedence first:

1. `data/config.json` — written by the `/setup` wizard via POST `/api/config`
2. `process.env.*` — set via `docker run -e`
3. baked-in defaults

Routes call `await loadConfig()` **once per request** and read
`cfg.services.<name>.{url,apiKey,username,password,configured}`.

> **Recurring bug class — do not repeat it:** reading `process.env.*` at *module
> scope* in a route makes wizard-written config invisible, because the module is
> evaluated once at boot and `data/config.json` changes later. This has been
> fixed at least three separate times (speedtest, Prometheus, smart). Always go
> through `loadConfig()` inside the handler.

Cached 5s. POST `/api/config` calls `invalidateConfigCache()` after a write, so
changes apply in seconds with no redeploy.

### API routes (33)

All server-side proxies. All credentials resolved via `loadConfig()`.

**Core data (the six SSE endpoints)**

| Route | Purpose |
|-------|---------|
| `metrics/` | Thin wrapper over `lib/metrics.ts`: ~30 PromQL queries, 9s cache, appends to `history.jsonl`. |
| `services/` | Thin wrapper over `lib/services.ts`: 10 service health cards, SWR + memoization. |
| `mikrotik/` | RouterOS stats (Basic auth). 10s cache. |
| `activity/` | Sonarr + Radarr history + Tautulli watches, merged. 60s cache. |
| `speedtest/` | SpeedTracker history. **Never triggers tests.** |
| `weather/` | open-meteo, no auth, + 3-day forecast. |

> **Metrics queries are a named object** resolved with `resolveNamed()` from
> `lib/prometheus.ts`. They used to be ~30 results destructured positionally out
> of one `Promise.all`, where inserting a query mid-list silently shifted every
> later value into the wrong field. Keep them named.

**Config & setup:** `config/` (runtime client config; POST writes
`data/config.json`), `test-connection/` (wizard's live auth check),
`bookmarks/`, `backup/` (export/import all of `data/`), `version/`,
`health/` (local-only liveness for the Docker HEALTHCHECK),
`diagnostics/` (collector status, per-origin circuit state, Prometheus
scrape-target health).

**Auth:** `auth/login/` (rate-limited), `auth/logout/`, `auth/status/`.

**Observability:** `history/` (ranged + downsampled), `insights/` (z-score
anomalies, linear-regression forecasts, SLA/MTTR), `smart/` (SMART disk health
from `smartmon_*`), `alerts/` (GET config+recent / PATCH config — deliberately
no POST; evaluation is the collector's job), `stream/` (SSE, also relays
collector alert fires).

**Infrastructure:** `docker/containers|logs|restart/`, `mikrotik/devices|wol/`,
`topology/`, `servers/` (multi-server fleet CRUD), `dependencies/` (service
dependency graph CRUD), `custom-cards/` + `custom-cards/query/`,
`grafana/render|test/`.

**`lib/services.ts` contract** — `ServiceResult` (see `lib/types.ts`):
- `configured: false` — required env var(s) missing. Returns immediately without
  hitting the upstream. Use the `unconfigured(name, ["VAR"])` helper. The
  frontend hides these from the grid and lists them in Settings → Connections.
- `envVar?: string[]` — the missing var names, surfaced in that panel.
- `queueItems?` — top-3 active downloads (Radarr/Sonarr/qBit). Legacy single
  `queueItem` still emitted for back-compat.
- `health?: { warning, error, messages? }` — from `/health` endpoints
  (Radarr/Sonarr/Prowlarr). Renders an amber/red pill.
- `weekly?` — Tautulli stats when no streams are active.
- `stale?` / `staleSince?` — served from last-known-good cache.
- `authError?` — upstream returned 401/403 (wrong key), distinct from down.

Each service function has one primary fetch that must succeed plus optional
enrichment fetches (`apiFetchOpt` returns `null` instead of throwing) that fail
individually without sinking the card.

### Frontend

`app/page.tsx` (~1500 lines) is the **orchestrator**, not the whole UI: state,
data wiring, the metric grid JSX, and layout. Everything reusable lives in
`app/components/`. When adding a feature, add a component — do not grow
`page.tsx` back into a monolith.

**Pages:** `/` (dashboard), `/setup` (config wizard with per-service Test
buttons), `/welcome` (4-step first-run flow, auto-redirected to when zero
services are configured), `/login`, `/analytics` (interactive area charts over
`/api/history`), `/forecast` (SLA + anomalies + resource forecasting), `/logs`
(container log viewer with search, level filters, tail mode).

**Primitives** (`components/primitives.tsx`): `Card`, `StatusBanner`, `GaugeBar`,
`Sparkline`, `RadialGauge`, `ThreeSegmentDonut`, `LabeledBar`, `BigValue`,
`StatRow`, `Skeleton`, `AnimatedNumber`, `TrendDelta`, `HeroStat`,
`animatedLine()`, `CARD_INFO`.

- **`AnimatedNumber`** — interpolates between values (~600ms ease-out cubic),
  preserving comma separators and decimal precision.
- **`animatedLine(line, keyPrefix)`** — parses `"16,173 queries today"` and wraps
  every numeric literal in `<AnimatedNumber>`. Use this for any pre-formatted
  stat string.
- **`HeroStat`** — splits `lines[0]` into big leading number + muted suffix.
- **`TrendDelta`** — ↑/↓ vs history. Caller sets `goodDirection` so coloring
  matches intent. Has a sanity guard: suppresses output when
  `|delta|/|current| > 5`, which catches unit-mismatch bugs (see `memory.md` →
  "Speedtest unit mismatch").
- **`Card`** — flat: `var(--card)`, 1px border, radius 10, no stripe/tint/glow/
  lift. A warning/critical `alertLevel` tints the border and adds a labelled
  dot. Keyboard-activatable (role="button"). Optional ⓘ popover from `CARD_INFO`.

**Feature components:** `StatusSummary`, `PageHeader`, `ServicesPanel`, `ServiceDetailSheet`, `BookmarksPanel`,
`SettingsPanel`, `SearchBar`, `MikrotikTab`, `GrafanaCard`, `ActivityFeed`,
`AreaChart`, `CommandPalette`, `KeyboardShortcuts`, `NotificationCenter`,
`HeaderSparklines`, `UptimeTimeline`, `DiskHealthPanel`, `NetworkTopology`,
`ServerFleetPanel`, `DependencyMap`, `CustomCards` + `CustomCardEditor`,
`ContainerLogsSheet`, `DraggableCard`, `ErrorBoundary`, `Modal`, `Clock`, `icons`.

**Layout.** Below 1280px the dashboard is one column. From 1280px it widens
(max 1560px) and splits in two — `.dash-columns` / `.dash-main` / `.dash-side`
in `globals.css`: metric grid, disk health, custom cards and activity on the
left; Plex now-playing and services on the right. The metric grid
(`.metric-grid`) is `auto-fill, minmax(260px, 1fr)`, so it fills whatever width
it gets; a full-width item inside it uses `.span-all`. Breakpoint rules live in
CSS rather than new Tailwind classes.

**Sub-pages** (Analytics, Forecast, Logs) share `components/PageHeader.tsx`:
`PageHeader` (ComExe mark, the same page nav as the dashboard with the current
page marked, a slot for the page's controls), `PageTitle`, and `Segmented` (a
quiet radio-group for time ranges). Setup and Welcome use theme tokens only —
no hardcoded hex/rgba, no glows.

**`StatusSummary`** is the first thing on the dashboard: "All systems normal", or
a list of what needs attention — crossed thresholds (`healthIssues()` in
`lib/alerts.ts`), down / auth-failed services, *arr health errors and warnings
(grouped into one row across apps), stale data, Uptime Kuma monitors down,
Prometheus exporters down. `collectIssues()` is pure and unit-tested.

**Services panel** is a compact grouped list (`SVC_CATEGORIES` in
`ServicesPanel.tsx`): *Media* (radarr, sonarr, bazarr, tautulli, qbittorrent,
overseerr, prowlarr) and *Infrastructure* (pihole, nginx, uptimekuma). One row
per service: status word + dot (the only colour), the app's full-colour icon and
name (links to its UI in a new tab), key number, detail line, and details /
logs / restart buttons. Queue items and Plex streams show as a sub-list. Rows
sort by health priority — down/auth → error → warning/stale → busy → idle —
preserving route order within a tier.

**Client state** lives in `localStorage`, all under a `comexe:` prefix:

| Key | Holds |
|-----|-------|
| `comexe:settings` | refresh interval + overrides, temp/data units, visible cards, search engine, timezone, theme |
| `comexe:card-order` | drag-to-reorder metric grid order |
| `comexe:layouts` | named layout presets (visibility + order) |
| `comexe:setup-wizard` | wizard form state, so a refresh doesn't clobber input |
| `comexe:welcome-done` | first-run flag |
| `comexe:update-dismissed` | per-release banner dismissal |

On mount the dashboard reads `comexe:settings`; if empty it seeds from the
server-side `preferences` in `/api/config`.

### Theming

Two themes — **Midnight** (calm dark, default) and **Paper** (light) — defined
in `lib/constants.ts` and implemented in `globals.css` (`:root` and
`.theme-paper`). Forge, Forest and Plum were retired in the Oct 2026 "calm"
redesign; `normalizeTheme()` maps any saved or configured value naming one of
them to Midnight.

**Two kinds of colour, kept apart.** *Status* — `--ok`/`--warn`/`--critical` —
appears only when something crossed a threshold or is broken. *Data* — each
metric has one soft, easy-on-the-eye accent for its icon and charts:
`--accent-cpu` (teal), `--accent-memory` and `--accent-network` (sky),
`--accent-network-tx` and `--accent-gpu` (orchid), `--accent-fs` and
`--accent-speedtest` (lavender), `--accent-system` (slate). Accents are muted,
of similar lightness, and never green/amber/red, so they can't read as status.
`barColor(p, base)` / `gpuUtilColor(p, base)` return the accent as `base` and
switch to warn/critical at threshold. `--data`/`--data-strong` are the neutral
fallback (queue bars, cache segments). `--brand` is for the logo, links and
focus only. No stripes, tints or glows. Every text shade down to `--text-ghost` passes 4.5:1 on
`--card`. **Don't reintroduce literal hex colors** where a variable exists, and
use `withAlpha()` (`lib/formatters.ts`, color-mix) for translucency — a hex
suffix on a `var()` is invalid CSS and silently drops the whole declaration.

`layout.tsx` runs an inline pre-hydration script that reads the saved theme from
localStorage (falling back to `prefers-color-scheme`) and sets the class before
React mounts, preventing a flash.

### Auth (optional, off by default)

- `DASHBOARD_PASSWORD` — native single-password auth, cookie session (7d),
  rate-limited login (10/min/IP), `/login` page.
- `AUTH_PROXY_HEADER` — trust an upstream proxy (Authelia, Authentik, Cloudflare
  Access). No login page.

**`proxy.ts`** (repo root) is the enforcement point — renamed from
`middleware.ts` for Next 16, which deprecated the `middleware` convention in
favour of `proxy` on the nodejs runtime.

**`lib/session-token.ts`** issues HMAC-signed stateless tokens
(`<nonce>.<issuedAt>.<hmac>`), with the signing key derived from
`DASHBOARD_PASSWORD` — so changing the password invalidates every session for
free. It is deliberately dependency-free (`node:crypto` only) so **both**
`proxy.ts` and the routes can import it; `lib/auth.ts` can't be imported by the
proxy because it pulls in `next/headers`. That split is exactly why the proxy
once checked only that the cookie *existed* — a full auth bypass. Keep signature
verification in the proxy.

### Persistence — `data/`

| File | Written by |
|------|------------|
| `config.json` | POST `/api/config` (the setup wizard) — **contains plaintext credentials** |
| `bookmarks.json` | POST `/api/bookmarks` |
| `custom-cards.json` | POST `/api/custom-cards` |
| `alerts.json` | `lib/alerts-dispatch.ts` (collector fires, `/api/alerts` PATCH) |
| `servers.json` | `/api/servers` |
| `dependencies.json` | `/api/dependencies` |
| `history.jsonl` | `lib/history.ts`, appended by `lib/metrics.ts` on every real fetch |

`data/` is **gitignored and dockerignored** — never commit it, never bake it
into an image. The directory is created on demand by the Dockerfile
(`mkdir -p /app/data`, owned by uid 1001) and by `json-store.ts`.

In production it must be a **writable mounted volume** at `/app/data`. `/api/config`
reports `writable: false` when it isn't, and the wizard degrades to "copy this
config manually" with `docker-compose` / `docker run` / `.env` tabs.

`history.jsonl` is a JSONL ring buffer, rotated at 30 days **or** 50MB
(`HISTORY_RETENTION_DAYS` / `HISTORY_MAX_SIZE_MB`), triggered every 500 writes
from `appendHistory`. Reads walk backwards from the newest line and stop at the
range cutoff rather than parsing the whole file.

> **Caution:** GET `/api/backup` bundles `config.json`, so a downloaded backup
> file contains every API key and password in plaintext. Treat it accordingly.

### Docker control (opt-in)

`/api/docker/*` is disabled unless `COMEXE_DOCKER_ENABLED=1`, because the socket
is root-equivalent. Container names are checked against a built-in allowlist
(the known service names) plus `COMEXE_DOCKER_ALLOW`. Keep both the env gate and
the allowlist on any new Docker-touching route.

---

## Env vars

Server-side only. **Never** prefix with `NEXT_PUBLIC_` — that bakes the value
into the client bundle and forces a rebuild to change it. All listed in
`.env.local.example`. Production values live in `/root/update-dashboard.sh` on
TrueNAS as `-e` flags. Never hardcoded in source, never in the image.

**Required for anything meaningful:** `TRUENAS_IP` (default `192.168.88.196`),
plus API keys for whichever services you use.

**Service credentials:** `RADARR_API_KEY`, `SONARR_API_KEY`, `BAZARR_API_KEY`,
`TAUTULLI_API_KEY`, `PROWLARR_API_KEY`, `OVERSEERR_API_KEY`, `PIHOLE_PASSWORD`,
`NGINX_USERNAME`/`NGINX_PASSWORD`, `UPTIME_KUMA_API_KEY`, `SPEEDTEST_API_KEY`,
`MIKROTIK_USERNAME`/`MIKROTIK_PASSWORD`, and `QBIT_API_KEY` (qBit 5.1+,
`qbt_...`) **or** `QBIT_USERNAME` + `QBIT_PASSWORD`.

**URL overrides** (default to `${TRUENAS_IP}:<port>`): `RADARR_URL`, `SONARR_URL`,
`BAZARR_URL`, `TAUTULLI_URL`, `QBIT_URL`, `OVERSEERR_URL`, `PIHOLE_URL`,
`PROWLARR_URL`, `NGINX_URL`, `UPTIME_KUMA_URL`, `SPEEDTEST_URL`,
`PROMETHEUS_URL`, `MIKROTIK_URL`.

**Infra:** `FS_PATH_PREFIX` (`/mnt/Pool/Media/`), `POOL_PATH` (`/mnt/Pool`),
`NETWORK_DEVICE_EXCLUDE` (`lo|veth.*|docker.*|br.*`), `WEATHER_LAT`/`WEATHER_LON`
(Launceston, TAS).

**Grafana:** `GRAFANA_BASE_URL`, `GRAFANA_DASHBOARD_UID`, `GRAFANA_DATASOURCE_UID`
(no default — embed is null if either is missing), `GRAFANA_PANEL_ID`
(`panel-77`), `GRAFANA_DASHBOARD_SLUG` (`node-exporter-full`),
`GRAFANA_API_TOKEN` (enables the server-side PNG render path, which sidesteps
iframe cookie problems entirely).

**Preferences:** `SEARCH_ENGINE` (`google`|`bing`|`duckduckgo`|`kagi`),
`TIMEZONE` (IANA, `""` = browser local), `THEME`.

**Auth / paths / misc:** `DASHBOARD_PASSWORD`, `AUTH_PROXY_HEADER`,
`BOOKMARKS_PATH`, `CONFIG_PATH`, `DOCKER_SOCK`, `COMEXE_DOCKER_ENABLED`,
`COMEXE_DOCKER_ALLOW`, `COMEXE_COLLECTOR` (`0` disables the background
collector), `HISTORY_RETENTION_DAYS`, `HISTORY_MAX_SIZE_MB`,
`COMEXE_GIT_SHA` (set by CI as a build-arg).

---

## Hard rules

- Never trigger speedtests — SpeedTracker schedules them.
- No external chart libraries. Canvas or inline SVG only.
- All outbound HTTP to an upstream goes through `lib/http.ts`. Never add a bare
  `fetch` — that bypasses the circuit breaker and leaves the origin invisible to
  `/api/diagnostics`.

  > There are exactly **two** deliberate exceptions, both documented at the call
  > site. Don't "fix" them:
  > - `stream/route.ts` — self-fetches our own origin. No upstream to protect,
  >   and breaker-gating it would let one failing internal route open a circuit
  >   against the dashboard itself.
  > - `weather/route.ts` — open-meteo is a public internet API, not a homelab
  >   container, and it depends on `next: { revalidate: 900 }`, which conflicts
  >   with `lib/http`'s `cache: "no-store"`.
  >
  > `test-connection` **does** use `lib/http`, but passes `skipBreaker: true`.
  > That flag is only for manual, user-initiated probes: the circuit for a
  > service is open precisely when that service has been failing, which is
  > exactly when someone opens the wizard to fix its credentials — a
  > breaker-gated Test would answer "circuit open" instead of testing the key.
  > **Never set `skipBreaker` on a polled path.**
- Wrap external fetches so failure renders `"—"`. Never crash the page.
- Resolve credentials via `loadConfig()` inside the handler, never
  `process.env` at module scope.
- Validate every write route's input with `lib/validate.ts` — several of them
  persist client JSON and one fetches client-supplied URLs server-side (SSRF).
- Never commit `data/` or `.env.local`.
- New hardcoded infra values (IPs, ports, paths, lat/lon) → env-var-driven from
  the start. This image is distributable; per-deploy values must not bake in.
- New client-side runtime config → expose via `/api/config`, never `NEXT_PUBLIC_*`.
- All external links open in `_blank`.
- `font-variant-numeric: tabular-nums` on all numeric displays.

---

## Styling conventions

- Use CSS variables (`var(--text-muted)`, `var(--data)`, …), not literal hex,
  wherever one exists — otherwise Paper breaks.
- Cards: `var(--card)` bg, 1px `var(--border)`, `border-radius: 10px`, padding
  16px. Hover only brightens the border. No stripes, tints, glows, lifts or
  pulsing dots.
- Severity (Midnight): ok `--ok` `#3fb950`, warn `--warn` `#d29922`, critical
  `--critical` `#f85149`. Pair colour with a word ("Down", "Warning") — never
  colour alone.
- Type: nothing under 12px. Roughly 12 (meta) / 13–14 (body) / 16–18
  (headings) / 32+ (headline numbers).
- Icons: line SVGs, never emoji. Service icons stay full colour (`SVC_ICONS`).
- Side panels (Settings): `min(420px, 100vw)` wide, 24px padding, sentence-case
  13px section headings, controls at least ~34px tall, `role="dialog"`.
- Fonts: Inter (UI), JetBrains Mono (numbers — `font-mono` or `var(--font-mono)`).
- Inline `style` for colors/sizes; Tailwind for layout/spacing/flex. No CSS
  modules, no styled-components.
- Mobile responsiveness **is** implemented (`sm:`/`lg:`/`xl:` breakpoints) —
  keep new layout work responsive rather than desktop-only.

---

## Testing

- **Unit** — vitest, `tests/unit/`. 263 tests over 20 files covering `app/lib/*`
  plus `tests/unit/routes/` for API route handlers.
- **E2E** — Playwright, `tests/e2e/smoke.spec.ts`, run by its own CI job.
- **Storybook** — `stories/Primitives.stories.tsx`.

**Writing a route test** (`tests/unit/routes/`): App Router handlers are plain
`(req: Request) => Response`, so import and call them directly — no Next runtime
needed. Two gotchas:
- Routes hold module-level caches, so `vi.resetModules()` in `beforeEach` and
  `await import(...)` inside the test body, not at file scope.
- `loadConfig()` reads `data/config.json` and `process.env` — mock it with
  `vi.doMock("@/app/lib/server-config", …)`.

`tests/unit/routes/grafana.test.ts` is the worked example.

> **Remaining gap:** route coverage is mostly the security-critical paths (the
> Grafana SSRF guard, the Content-Type guard on all 13 write handlers), plus
> `lib/metrics.ts` (field mapping, ZFS pool maths), `lib/services.ts`
> (unconfigured short-circuit, stale fallback) and the collector. Still
> untested: `insights`'s z-score/regression maths and the Docker allowlists.
>
> Shared state lives on `globalThis` (see "Background collector"), which
> `vi.resetModules()` does not clear — call `resetGlobalSingletons()` from
> `tests/unit/helpers/singletons.ts` in `beforeEach`.

---

## Domain knowledge

**Prometheus** — single instance at `${TRUENAS_IP}:30104`. GPU metrics use
`nvidia_smi_*`. Network device is `enp4s0`. SMART metrics come from
`smartmon_*` and degrade gracefully when the exporter isn't installed.

**Memory accounting** — TrueNAS ZFS ARC inflates raw `MemAvailable`. Use
`MemTotal - MemAvailable - SReclaimable` as real-used. Warn >93%, critical >97%
(see `lib/alerts.ts` for the authoritative thresholds).

**Filesystem filter** — only mounts under `FS_PATH_PREFIX` are shown. Exclude
`tmpfs|devtmpfs|overlay|squashfs|ramfs` at the PromQL level.

**GPU temp** — warn >80°C, critical >90°C. **CPU** — warn >80%, critical >95%.
**Disk** — warn >85%, critical >95%.

**Service ports** — see `SVC_PORTS` in `lib/constants.ts` and `context.md`.

**Known CORS surfaces** — must be called server-side, never from the browser:
PiHole `:20720`, Bazarr `:30046`, qBittorrent `:30024` (all via
`services/route.ts`), MikroTik `192.168.88.1` (via `mikrotik/route.ts`).

---

## MCP tools available

- **Context7** — fetch latest library docs. Use before writing code touching
  Next.js, React, Tailwind, or Node. Prefer over WebFetch/WebSearch for docs.
- **Playwright** — browser automation for verifying UI changes.

## Hashmi-homelab skill

`.claude/skills/Hashmi-homelab/SKILL.md` — workflow + style conventions
(PC = PowerShell, TrueNAS = bash, concise direct prose, secrets via `-e` flags
only). Apply on any task touching this repo, Docker on TrueNAS, MikroTik, or
related services.

`.gitignore` lists `.claude/`, but **this one file is tracked** and does survive
a fresh clone — it was committed before the ignore rule existed, and an ignore
rule has no effect on an already-tracked path. Everything else under `.claude/`
(settings, launch config, worktrees) is genuinely ignored. Keep the skill file in
sync when conventions change here; it is the only part of `.claude/` that other
clones see.

## Supplementary files

| File | Purpose |
|------|---------|
| `context.md` | Infra inventory — env var names, ports, hardware specs |
| `memory.md` | Past bug fixes and architectural decisions |
| `skills.md` | Reusable code patterns (PromQL, polling, primitives) |
| `ROADMAP.md` | Shipped-tier changelog; open work is in Parts A/B/C at the end |
| `INSTALL.md` | End-user install guide |
| `.env.local.example` | Template for `.env.local` (gitignored) |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
