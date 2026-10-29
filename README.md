<p align="center">
  <img src="app/icon.svg" alt="ComExe" width="96" />
</p>

<h1 align="center">ComExe</h1>

<p align="center">
  A calm, self-hosted dashboard for a TrueNAS Scale homelab.
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-blue?logo=typescript" />
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-ghcr.io-2496ed?logo=docker" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-lightgrey" />
</p>

ComExe brings your homelab onto one page: live system metrics from Prometheus, the health of your
media and infrastructure services, Plex streams, downloads, speedtests and weather. The first
thing it shows is the answer to the only question that matters at a glance — **is anything
wrong?** — and colour only appears when something is.

Everything is set up from a web wizard with live "Test connection" buttons. No database, no
external state, no secrets in the browser: every upstream call goes through a server-side route.

![ComExe dashboard](docs/screenshots/dashboard.png)

<sub>All screenshots use the built-in demo data (append `?demo=1` to any URL) — no real services involved.</sub>

---

## Highlights

- **Status at a glance** — a summary line reads *All systems normal*, or lists exactly what needs
  attention: a crossed threshold, a service that's down or rejecting its credentials, *arr health
  errors (grouped across apps), stale data, Uptime Kuma monitors down, Prometheus exporters down.
- **Calm by design** — flat cards, one soft accent per metric for its charts, and status colours
  (green / amber / red) reserved for actual problems, always paired with a word.
- **Services in one list** — Radarr, Sonarr, Bazarr, Tautulli, qBittorrent, Overseerr, Prowlarr,
  Pi-hole, Nginx Proxy Manager and Uptime Kuma, each with its own icon, status, key number,
  download queue or Plex stream, sorted so problems come first.
- **Alerts with no tab open** — a background collector keeps evaluating thresholds and recording
  history around the clock, and sends webhooks to Discord, Slack, ntfy or any JSON endpoint,
  with throttling and quiet hours.
- **Set up in the browser** — the `/setup` wizard tests each service's credentials live, saves to a
  mounted volume and applies within seconds. Saved keys are never sent back to the browser, and a
  blank field keeps the saved one.
- **Gentle on your homelab** — one server-sent-events stream instead of many pollers, per-origin
  connection caps, a circuit breaker, memoised heavy calls and hard minimum intervals. (The first
  version polled every 3 s and crashed the *arr containers; this is the fix.)

## Screenshots

| Light theme (Paper) | Phone |
|---|---|
| ![Paper theme](docs/screenshots/dashboard-paper.png) | <img src="docs/screenshots/mobile.png" alt="Phone layout" width="320" /> |

| Settings | Setup wizard |
|---|---|
| ![Settings panel](docs/screenshots/settings.png) | ![Setup wizard](docs/screenshots/setup.png) |

---

## Features

### Metrics

- **CPU** — usage, load averages, cores and clock, history sparkline
- **Memory** — used / ZFS cache / free, with ZFS-aware accounting (`MemTotal − MemAvailable − SReclaimable`)
  so the ARC doesn't look like a leak
- **Filesystems** — pool fullness plus each dataset under your media path
- **Network** — download and upload throughput with history, totals, established TCP connections
- **GPU** — utilisation, temperature, power draw, VRAM, clocks, fan, encoder/decoder load
- **Speedtest** — latest result and history from SpeedTracker (read-only — it never triggers a test)
- **System** — OS, kernel, architecture, host, uptime, plus an uptime timeline
- **Disk health** — SMART temperatures and sector errors when the smartmon exporter is installed
- **Grafana** — embed any panel; with an API token it renders server-side, no iframe cookies

### Pages

- **Dashboard** — two columns on wide screens (metrics beside services), one on a phone
- **Analytics** — history charts for CPU, memory, GPU, disk and network over 1 h – 7 d
- **Forecast** — uptime / SLA, incidents and MTTR, anomaly detection, and when resources run out
- **Logs** — container log viewer with search, level filters and live tail (opt-in Docker access)
- **Setup** and a short **welcome** flow for first runs

### Everything else

Two themes (Midnight, Paper) · command palette (`Ctrl+K`) and keyboard shortcuts · bookmarks ·
MikroTik router bar, device list and Wake-on-LAN · network topology and service dependency map ·
multi-server fleet view · custom PromQL cards · drag-to-reorder cards and saved layouts ·
config backup and restore · optional password or auth-proxy login · PWA install.

---

## Install

A prebuilt multi-arch image (amd64 + arm64) is published to
**`ghcr.io/syedhashmi-bit/comexe:latest`** on every push to `main`. You don't need to clone or build anything.

> The full guide — TrueNAS Custom App walkthrough, docker-compose, bookmarks, Grafana and
> troubleshooting — is in **[INSTALL.md](./INSTALL.md)**.

### Quick start

```bash
mkdir -p dashboard-data

docker run -d \
  --name comexe \
  --network host \
  --restart unless-stopped \
  -v "$(pwd)/dashboard-data:/app/data" \
  ghcr.io/syedhashmi-bit/comexe:latest
```

Open **`http://<your-host>:3000/setup`**, enter your TrueNAS IP, tick the services you run, paste
each API key, click **Test**, then **Save & apply**.

The `dashboard-data` mount is what keeps your settings across updates. Without it the wizard
falls back to generating a `docker-compose.yml` / `docker run` snippet for you to apply yourself.

### Updating

[`scripts/update-dashboard.sh`](scripts/update-dashboard.sh) is a health-gated updater: it pulls
the new image, starts it as a candidate on a spare port, only replaces the running container once
the candidate is healthy, keeps the previous image tagged `:rollback`, and makes sure `/app/data`
is on a host mount so nothing you configured is lost.

### Configuration

- **Wizard first** — `/setup` writes `data/config.json` on your mounted volume; changes apply in seconds.
- **Or env vars** — anything can be set with `docker run -e …` for headless deploys; the full list
  is in [`.env.local.example`](./.env.local.example).
- **Precedence** — wizard file › env vars › built-in defaults.
- **No secrets in the image** — credentials are read at request time, never baked in.

### Security

ComExe is built for a single user on a private LAN. Auth is off by default; set
`DASHBOARD_PASSWORD` for a login page, or `AUTH_PROXY_HEADER` behind Authelia / Authentik /
Cloudflare Access. It only answers to IP addresses, `localhost` and LAN-style names (anything
else is refused, which blocks DNS-rebinding attacks); list other hostnames in
`COMEXE_ALLOWED_HOSTS`. See [INSTALL.md](./INSTALL.md#security-notes).

---

## Alert thresholds

| Metric | Warning | Critical |
|---|---|---|
| CPU usage | > 80 % | > 95 % |
| Memory (real, ZFS-aware) | > 93 % | > 97 % |
| Filesystem usage | > 85 % | > 95 % |
| GPU temperature | > 80 °C | > 90 °C |
| Service unreachable | — | any configured service |
| Service health checks | ≥ 1 warning | ≥ 1 error |

[`app/lib/alerts.ts`](app/lib/alerts.ts) and [`app/lib/alert-events.ts`](app/lib/alert-events.ts)
are authoritative.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `G` | Focus the search bar |
| `R` | Refresh everything now |
| `H` | Toggle bookmarks |
| `/` | Filter services |
| `Ctrl+K` | Command palette |
| `?` | Shortcuts overlay |
| `Esc` | Close panels / leave an input |

---

## Reference hardware

| Component | Spec |
|---|---|
| CPU | Intel Xeon E5-2680 v4 (28 cores) |
| RAM | 63 GB ECC |
| GPU | NVIDIA GeForce GTX 1660 SUPER (6 GB) |
| Storage | 4.4 TB ZFS pool |
| OS | TrueNAS Scale (Electric Eel 24.10+, runs apps on plain Docker) |
| Router | MikroTik hAP ax³ — RouterOS 7.22.x |
| Network | `192.168.88.0/24` flat LAN |

---

## How it works

```
browser ──── one SSE stream (/api/stream) ────┐
                                              ▼
                              Next.js server routes (33)
        ┌────────────┬──────────────┬─────────┴───────┬──────────────┐
   Prometheus   *arr / Plex /   SpeedTracker      MikroTik      open-meteo
   (~30 PromQL) Pi-hole / … (10)  (read-only)      (REST)       (weather)
                                              ▲
            background collector ─────────────┘  alerts, webhooks, history.jsonl
```

- **Server-side only** — the browser never calls internal IPs, so credentials stay on the server
  and CORS never comes up.
- **One stream, polling as fallback** — `/api/stream` pushes metrics, services, router, activity,
  speedtest and weather on their own timers; if it fails three times the page falls back to polling.
- **Load protection** — max 2 sockets per upstream, a per-origin circuit breaker, 5-minute memoisation
  of heavy library calls, staged batches, and minimum intervals users can't override.
- **Background collector** — evaluates alerts and appends history even with no tab open; while a
  tab is connected it reuses the stream's data instead of polling again.
- **No chart libraries** — every sparkline, donut, gauge and chart is hand-written SVG or Canvas.

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, 7 pages, 29 components) |
| Language | TypeScript 6 |
| Styling | Tailwind CSS 3, CSS variables for the two themes |
| Charts | Inline SVG and Canvas, no chart library |
| Runtime | Node 22 in a multi-stage Docker image |
| Tests | Vitest (269 unit tests) and Playwright (end-to-end) |

---

## Local development

```powershell
npm install
npm run dev          # http://localhost:3000 — add ?demo=1 for sample data
npm run lint
npx tsc --noEmit
npm test             # vitest
npm run test:e2e     # playwright
npm run storybook    # primitives sandbox on :6006
```

CI runs lint, the type check and the unit tests before any image is published, plus the
end-to-end suite as a separate job. Architecture notes and conventions live in
[`CLAUDE.md`](./CLAUDE.md).

<details>
<summary>Project structure</summary>

```
.
├── app/
│   ├── api/                 33 server routes — metrics, services, stream (SSE), alerts,
│   │                        history, insights, config, test-connection, docker, smart, …
│   ├── components/          StatusSummary, ServicesPanel, PageHeader, SettingsPanel,
│   │                        primitives (Card, Sparkline, gauges), …
│   ├── hooks/               useEventStream (SSE with polling fallback), usePolling
│   ├── lib/                 27 shared modules — config resolution, http + circuit
│   │                        breaker, caches, collector, alerts, formatters, …
│   ├── analytics/ forecast/ logs/ setup/ welcome/ login/
│   ├── globals.css          Theme tokens (Midnight, Paper) and layout
│   └── page.tsx             Dashboard
├── instrumentation.ts       Starts the background collector
├── proxy.ts                 Auth and hostname guard
├── scripts/update-dashboard.sh   Health-gated updater for TrueNAS
├── docs/screenshots/        README images (captured from demo mode)
├── Dockerfile               Multi-stage build
└── INSTALL.md · CLAUDE.md · .env.local.example
```

</details>

---

## License

MIT
