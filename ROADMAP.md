# ComExe Roadmap

Next features, ordered by lift. Goal across all of them: make the dashboard
beginner-friendly enough that someone who's never touched Docker can spin it up,
follow a guided welcome flow, and end up with a working dashboard without ever
opening a terminal past `docker run`.

---

## Tier 1 — quick wins ✅ shipped

### ✅ Search engine picker
Shipped in `73173d8`. `GoogleSearch` → generic `SearchBar` with per-engine SVG
icons. Options: **Google · Bing · DuckDuckGo · Kagi**. Persisted via
localStorage + server config (`preferences.searchEngine`). Configurable in both
Settings panel and `/setup` wizard.

### ✅ Timezone setting
Shipped in `73173d8`. Header clock uses `Intl.DateTimeFormat` with an IANA
timezone. ~30 major timezones in the selector, "" = browser local. Persisted
same as search engine (`preferences.timezone`).

### ✅ 3-day weather forecast
Shipped in `73173d8`. Weather pill now shows a hover popup with the next 3 days
— emoji, condition, high/low. Uses open-meteo `daily` endpoint (no new API, no
key). `ForecastDay` type exported from weather route.

---

## Tier 2 — medium lift ✅ shipped

### ✅ Editable bookmarks in the UI
Shipped. Inline editing directly on the dashboard — add/remove sections, add/remove
items, reorder via up/down buttons. New `/api/bookmarks` POST endpoint writes to
`data/bookmarks.json`. Icons use favicon URL field (base64 capped at ~15kb).
Existing `bookmarks.json` mount keeps working as read-only fallback.

### ✅ Multi-Grafana with size picker
Shipped. `grafana.panels` array in config, each with `panelId`, `label`, and
`size` (`sm`=1col, `md`=2col, `lg`=3col/full-width). Setup wizard has "+ Add
panel" UI with size radio. `GrafanaCard` refactored into `GrafanaPanel` (single
iframe) + `GrafanaCard` (multi-panel grid layout).

---

## Tier 3 — big lift ✅ shipped

### ✅ First-run welcome flow + 5 themes
Shipped. CSS-variable refactor replaced ~250 hardcoded colors with custom
properties (`--bg`, `--card`, `--text`, `--brand`, etc.). Five theme classes
in `globals.css`: **Midnight** (cyan), **Forge** (amber), **Forest** (emerald),
**Plum** (magenta), **Paper** (light). Theme flash prevention via inline
`<script>` in `layout.tsx` reading localStorage before React hydrates.

Welcome flow at `/welcome` — 4-step wizard:
1. Welcome — logo, what ComExe does, overview of next steps
2. Pick a theme — 5 tiles with live preview
3. Connect services — links to `/setup` wizard
4. Done — confirmation + "Go to dashboard" button

Auto-redirect from `/` to `/welcome` when zero services configured and
welcome-done flag not set. Theme persisted to localStorage + server config.

### ✅ Beginner-friendliness pass
Shipped. All items except the YouTube walkthrough (separate non-code task):

- **API-key help tooltips** — every service in `/setup` has a "Where to find
  it:" hint with the exact UI path (e.g. Radarr → Settings → General → API Key).
- **Info modals on metric cards** — ⓘ icon on Card component, hover shows
  plain-English explainer for CPU, Memory, Filesystems, Network, GPU,
  Speedtest, System, Grafana.
- **Inline service-down hints** — "Can't reach {url} — is the container
  running?" instead of a bare red dot.
- **Demo mode** — `?demo=1` bypasses all API polling, seeds realistic fake
  data for every card. Orange banner with dismiss link.

---

## Sequencing (completed)

All tiers shipped. Order was:

1. ✅ Search engine picker + timezone + forecast
2. ✅ CSS-variable refactor (standalone commit `8cca9b2`)
3. ✅ 5 themes + theme picker UI
4. ✅ Welcome flow
5. ✅ Editable bookmarks
6. ✅ Multi-Grafana with size picker
7. ✅ Beginner-friendliness pass (tooltips, info modals, demo mode, service hints)

---

## Resolved decisions

- **Weather provider** — stayed on open-meteo (free, keyless). Added 3-day forecast.
- **Icon upload format** — base64 inline with ~15kb cap. Favicon URL fallback for simplicity.
- **Theme persistence** — both: server-side `config.json` seeds new browsers, localStorage
  overrides per-browser. Welcome wizard and settings panel write both.
- **Demo mode data** — generated at request time in `buildDemoMetrics()` / `buildDemoServices()`
  with realistic values. Deterministic enough for visual testing.

---

## Tier 4 — shipped ✅

All P0/P1/P2 items below are now in main. See commits 84b2a17 (Grafana
troubleshooter), 49a1f56 (alerts), 59e0fec (drag/refresh/search),
eb0f199 (PWA + update banner), 8b2f18c (MikroTik devices + WoL),
724aecc (Docker actions), b18ca57 (native Grafana panels).

### ✅ Alerts & notifications (P0)
Right now metric and service thresholds change a colour pill and nothing else.
Add real alerting:

- **Browser Notifications API** — opt-in toast/native notification on critical
  events (service down, CPU >95%, disk >90%, GPU temp >85°C). Bound to a
  visible "Enable alerts" button in Settings, debounced so a flapping
  service doesn't spam.
- **Webhook delivery** — POST to user-supplied URL on the same events.
  Templates for Discord, ntfy, Slack, Gotify, generic JSON. Per-event throttle
  (default 5 min) so a stuck-down service doesn't fire 20 times an hour.
- **Quiet hours** — local-time window where webhooks suppress (default
  22:00–07:00, user-configurable). Browser notifications respect OS DND.
- **Alert history pill** — small dot in the header showing last 24h alert
  count; click opens a sidesheet with timestamps.

Server side: a new `app/api/alerts` route that evaluates thresholds on each
metric poll, dedupes, and dispatches. Persist last-fire timestamp per
`(event, target)` in `data/alerts.json` so a container restart doesn't
re-fire stale alerts.

### ✅ Grafana embed troubleshooter (P0)
Current production shows "Forbidden" in the Grafana iframe because anonymous
access isn't enabled on Grafana, and iframes don't carry session cookies. The
card should explain *why* and offer fixes:

- Detect iframe load failure (timeout + dimensions check) and replace with an
  inline help card.
- Surface three options the user can pick from:
  1. Enable Grafana anonymous viewer (one-liner for `grafana.ini` + the env
     vars to set on the Grafana container)
  2. Use a service account API token with `Viewer` role (paste here →
     stored as `GRAFANA_API_TOKEN`, server-side proxy fetches panel PNGs)
  3. Disable the Grafana card entirely (Settings → hide card)
- Pre-flight check on `/setup` — when user enters Grafana URL, test
  `?orgId=1` *and* `/render/d-solo/...` to detect anon vs token setup.

### ✅ Native Grafana panels (no iframe) (P1)
Longer fix: replace the iframe with a server-side proxy that fetches the
panel as PNG via Grafana's `/render` API, or queries the underlying
datasource via the `/api/ds/query` endpoint and renders with our own Canvas
chart code. Removes the auth / X-Frame issue entirely and respects our theme.

### ✅ Drag-to-rearrange cards (P1)
The 3-column metric grid is hardcoded. Users want different priorities.

- HTML5 drag-drop on every Card top-stripe (cursor change on hover).
- Persist order in localStorage as `comexe:card-order` (per-browser, not
  per-server — each device can have its own layout).
- "Reset layout" button in Settings.
- Same treatment for the services panel grid (within a category).

### ✅ Per-card refresh override (P1)
Single `settings.refreshInterval` applies everywhere. Some users want metrics
at 1s but services at 30s. Add a sub-config:

- `settings.refreshOverrides: { metrics?: number; services?: number; mikrotik?: number; activity?: number }`
- UI in Settings → "Polling intervals" section with sliders per endpoint.
- Default-on toggle: "pause polling when tab not visible" (uses `document.hidden`).

### ✅ Container actions (P1)
Wire up the Docker socket (`-v /var/run/docker.sock:/var/run/docker.sock:ro`)
to expose:

- **Restart** button on each service card (asks for confirm, calls Docker API).
- **Logs** button — sidesheet with last 200 lines, tail-follow toggle.
- **Pull & restart** button on the ComExe card itself for one-click updates.

Behind a `--cap-add` and an explicit env-var opt-in (`ENABLE_DOCKER_CONTROL=1`)
since the Docker socket grants root-equivalent on the host.

### ✅ MikroTik device list + WoL (P1) · ⏸ per-IP bandwidth deferred
Mikrotik tab currently shows only router-level stats. Add:

- DHCP leases table (host, MAC, IP, last-seen, vendor lookup).
- Per-IP traffic counters from `/queue/simple` or `/ip/firewall/connection`.
- Wake-on-LAN button per offline device (sends magic packet from the
  ComExe container; requires `--network host` which we already use).
- Block/unblock toggle (writes to firewall rule). Behind same Docker-control
  env opt-in for safety.

### ✅ Service-search (P1)
Press `/` to focus a fuzzy filter that highlights matching service cards and
scrolls them into view. Useful once the services panel grows past 10–15
cards.

### ✅ PWA manifest (P2) · ⏸ offline shell deferred (needs service worker)
Add `manifest.json` + a minimal service worker so the dashboard can be
installed as an app icon on phones/tablets/desktops. Offline shell falls back
to the last cached metrics with a "stale since {ts}" banner — useful when
the wifi blips but the user just wants to glance at the dashboard.

### ✅ Update-available banner (P2)
On every page load, compare `process.env.IMAGE_DIGEST` (baked at build time
via Dockerfile `ARG`) with the digest of `:latest` on GHCR. If newer, show a
dismissable banner: "v1.4 available — release notes". Click-through links to
the GitHub release page.

---

## Tier 5 — bigger initiatives

### Authentication & HTTPS (P0 for internet-exposed, P3 for LAN-only)
Today there's no auth on any endpoint. Acceptable for LAN-only but blocks
anyone wanting to expose ComExe behind their reverse proxy. Two levels:

- **Reverse-proxy mode** — trust an `X-Authenticated-User` header from an
  upstream auth-proxy (Authelia, Authentik, Cloudflare Access). Env-flagged.
- **Native basic auth** — single shared password via `DASHBOARD_PASSWORD`
  env var, cookie-based session, rate-limited login endpoint.

Either way: a per-route guard in `middleware.ts` that protects all `/api/*`
and the page itself.

### Multi-arch image (arm64) (P2)
Today CI publishes amd64 only. Add arm64 to the matrix so Raspberry Pi /
Apple Silicon mini-server users can run it. `docker buildx build
--platform linux/amd64,linux/arm64` in the workflow.

### Historical persistence (P2)
All in-memory history (`MAX_HISTORY = 60`) is lost on browser refresh.
Server-side ring buffer in `data/history.jsonl` (append-only, rotate at 7d /
50MB), exposed via `/api/history?metric=cpu&range=24h`. Powers richer
sparklines and lets new tabs immediately see the last hour.

### Custom card builder (P3)
Right now adding a new metric requires editing `app/page.tsx`. Let users
define ad-hoc cards in the wizard:

- Pick a PromQL query
- Pick a viz type (sparkline / gauge / number / bar)
- Pick a colour and a position
- Save → stored in `data/custom-cards.json` and rendered after the built-in grid.

### Automated tests (P2)
There are currently zero tests. Add:

- Playwright smoke tests for the three critical flows: welcome → setup →
  dashboard, bookmark add/edit/save, theme switcher.
- Unit tests for the resolvers in `app/lib/server-config.ts` and
  `app/lib/bookmarks.ts`.
- Vitest + Playwright `@playwright/test` runner, CI step gated on PRs.

### Storybook for primitives (P3)
20+ primitive components live in `app/components/primitives.tsx` with no
isolated rendering. A Storybook would catch regressions and document every
prop combo (`Card alertLevel`, `Sparkline gradient`, `RadialGauge thresholds`).

---

## How to pick next

Tier 4 is fully shipped. The Tier 5 list above is what remains. My
recommendation: **arm64 multi-arch + historical persistence** are the two
that have the broadest user impact. Auth & HTTPS only matters if you're
exposing ComExe to the internet (don't, without a reverse proxy + auth
in front).

Earlier recommendation (now stale): build **alerts + Grafana
fix** (Tier 4 P0). Both have visible user value, both are reasonably scoped,
and neither requires new infra. Auth / HTTPS only matters once someone
actually wants to expose ComExe to the internet — and the docs already
warn against doing that without a proxy.
