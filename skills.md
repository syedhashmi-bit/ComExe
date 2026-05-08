# Project Skills

Reusable coding patterns for this repo. **`CLAUDE.md` is authoritative** — when this file conflicts with it, CLAUDE.md wins.

## Tech Stack

- Next.js 15 (App Router) · TypeScript · Tailwind CSS · Node 20 · npm
- No external chart libraries — Canvas or inline SVG only
- No DB, no auth, no state library

## Architecture pattern: server-side proxy routes

Data fetching is **server-side** in Next.js API routes. The browser only talks to our own routes (`/api/*`); routes proxy to Prometheus / homelab services. Avoids CORS and keeps creds server-side.

Five active routes:

| Route | Purpose |
|-------|---------|
| `app/api/metrics/route.ts` | Prometheus PromQL (~20 queries via `Promise.all`) |
| `app/api/services/route.ts` | Homelab service health (Radarr, Sonarr, Bazarr, …) |
| `app/api/speedtest/route.ts` | SpeedTracker history (read-only, never trigger) |
| `app/api/weather/route.ts` | Open-Meteo |
| `app/api/mikrotik/route.ts` | MikroTik proxy (client component falls back to hardcoded values on CORS) |

### API route conventions

- **In-memory cache, 10s TTL** — every route caches its response in a module-level `Map<string, {data, ts}>`.
- **`Promise.allSettled`** for fan-out fetches across services so one failure doesn't tank the response.
- **Try/catch around every external fetch** — return `"—"` placeholders on failure, never crash.
- **`AbortSignal.timeout(3000)`** on every fetch.
- **Positional destructuring in `metrics/route.ts`** must stay in sync with the queries array. Add a query → add a destructure slot in the same index.

### Client polling pattern

```typescript
useEffect(() => {
  const fetchData = async () => {
    try {
      const res = await fetch('/api/metrics');
      const json = await res.json();
      setState(json);
    } catch (e) {
      console.error(e);
    }
  };
  fetchData();
  const id = setInterval(fetchData, settings.refreshInterval * 1000);
  return () => clearInterval(id);
}, [settings.refreshInterval]);
```

Poll intervals (managed in `Dashboard` component):

| Endpoint | Interval |
|----------|----------|
| `/api/metrics` | `settings.refreshInterval`s (default 10s) |
| `/api/services` | 10s |
| `/api/speedtest` | 300s |
| `/api/weather` | 600s |
| Clock | 1s |

## MikroTik via server-side route

`MikrotikTab` fetches `/api/mikrotik` (server route), NOT the router directly — the prior client-side fetch was always CORS-blocked. The server route uses Basic auth with `MIKROTIK_USERNAME` / `MIKROTIK_PASSWORD` env vars. On error (timeout, bad creds), the component renders a static-info row with hardcoded board/version/IP and `—` placeholders. Whole row is `<a href="http://192.168.88.1">` so it stays clickable either way.

## Prometheus query reference

Endpoint: `http://192.168.88.196:30104/api/v1/query?query=<PROMQL>`
Response shape: `{ data: { result: [{ value: [ts, "stringValue"] }] } }`

| Need | Query |
|------|-------|
| CPU % | `100-(avg(rate(node_cpu_seconds_total{mode="idle"}[1m]))*100)` |
| RAM total | `node_memory_MemTotal_bytes` |
| RAM available | `node_memory_MemAvailable_bytes` |
| RAM reclaimable | `node_memory_SReclaimable_bytes` |
| Net RX | `rate(node_network_receive_bytes_total{device="enp4s0"}[1m])` |
| Net TX | `rate(node_network_transmit_bytes_total{device="enp4s0"}[1m])` |
| Uptime | `node_time_seconds - node_boot_time_seconds` |
| Disk size | `node_filesystem_size_bytes` |
| Disk used | `node_filesystem_used_bytes` |
| GPU util (0–1, ×100 for %) | `nvidia_smi_utilization_gpu_ratio` |
| GPU temp °C | `nvidia_smi_temperature_gpu` |
| GPU VRAM used (÷ 1073741824 GB) | `nvidia_smi_memory_used_bytes` |
| GPU VRAM total | `nvidia_smi_memory_total_bytes` |
| GPU power W | `nvidia_smi_power_draw_watts` |
| GPU power limit W | `nvidia_smi_power_limit_watts` |

## Memory accounting (TrueNAS-specific)

ZFS ARC inflates raw `MemAvailable`. Use:

```
real_used    = MemTotal - MemAvailable - SReclaimable
real_percent = real_used / MemTotal * 100
```

Thresholds: `>85%` warning, `>95%` critical. Donut chart shows total-with-cache; banner uses `real_percent` only.

## Filesystem filter

Only mountpoints under `/mnt/Pool/Media/` rendered. Excluded fstypes (filtered at PromQL via `FS_EXCLUDE`): `tmpfs`, `devtmpfs`, `overlay`, `squashfs`, `ramfs`.

## Speedtest data shapes

```
GET http://192.168.88.196:30220/api/v1/results?take=20
```

`extractArray()` handles all observed envelopes: `{data:[]}`, `{results:[]}`, `{data:{results:[]}}`, single-item.
`normalizeMbps()` — `>1_000_000` ⇒ bps→Mbps; `>1_000` ⇒ kbps→Mbps; else passthrough.

## UI primitives (all live in `app/page.tsx`)

`GaugeBar`, `Sparkline`, `MiniBarChart`, `DonutChart`, `ThreeSegmentDonut`, `BigValue`, `LabeledBar`, `SubRow`, `StatRow`, `Card`, `StatusBanner`, `SettingsPanel`, `SpeedtestDualChart` (SVG), `SpeedtestBarChart` (Canvas + DPR + ResizeObserver), `GoogleSearch`, `MikrotikTab`, `ServiceIcon`, `BookmarkItem`.

### Canvas chart pattern (`SpeedtestBarChart`)

- DPR scaling: `canvas.width = clientWidth * devicePixelRatio`, then `ctx.scale(dpr, dpr)`.
- `ResizeObserver` inside `useEffect` triggers redraw — fixes "only 1 bar drawn" on first mount when canvas has zero dimensions.
- Tooltip mutated via `ref` directly, not React state, to avoid per-mousemove re-renders.
- Effect dependency is the raw `results` prop, not a derived array.

### `Sparkline` gradient ID

Uses `useId()` for the SVG `<linearGradient>` id. Removing this collapses gradients across instances. Don't.

## Color palette

- Background: `#0a0c12` + radial gradient overlay
- Card bg: `rgba(255,255,255,0.04)`, border `rgba(255,255,255,0.08)`, hover border `rgba(255,255,255,0.15)`
- Text: primary `#ffffff`, secondary `rgba(255,255,255,0.65)`, muted `rgba(255,255,255,0.45)`, very muted `rgba(255,255,255,0.25)`
- Accents: cyan `#06b6d4`, green `#10b981`, amber `#f59e0b`, red `#ef4444`, purple `#8b5cf6`, blue `#3b82f6`, magenta `#d946ef`, orange `#f97316`

## Card accent assignment

| Card | Color |
|------|-------|
| CPU | `#06b6d4` |
| Memory | `#10b981` |
| Filesystems | `#f59e0b` |
| Network | `#3b82f6` |
| GPU | `#ef4444` (dynamic via `gpuUtilColor`) |
| Speedtest | `#8b5cf6` |
| System | `#d946ef` |

## Progress bar / sparkline style

- Track: `rgba(255,255,255,0.08)`, height `5px` (`3px` thin variant), `border-radius: 999px`
- Severity fill colors: ok `#10b981`, mid `#06b6d4`, warn `#f59e0b`, critical `#ef4444`
- Sparkline: `36px` tall, line in card accent, subtle gradient fill below, no axes/labels

## Hard rules — never break

- Never trigger speedtests — SpeedTracker handles scheduling.
- Never use external chart libraries.
- Always wrap external fetches in try/catch; render `—` on failure.
- Always `target="_blank"` on external links.
- `font-variant-numeric: tabular-nums` on every numeric display.
- Mobile responsiveness is **not** required.
- Never bake secrets into the Dockerfile or commit them. Server-side `process.env.*` only.

## Styling conventions

- Inline `style` props for colors/sizes; Tailwind for layout/spacing/flex.
- No CSS modules, no styled-components.
- Fonts: Inter for UI, JetBrains Mono for numbers (`font-mono` or `fontFamily: "monospace"`).

## Component patterns (post-polish-pass)

### `AnimatedNumber` + `animatedLine()`

Wraps every numeric literal in a stat string with a smoothly-interpolated value. Use whenever rendering a string that contains numbers and might re-render with new values:

```tsx
{up && lines.map((line, i) => (
  <span key={i}>{animatedLine(line, `${name}-${i}`)}</span>
))}
```

`AnimatedNumber` interpolates over ~600ms with ease-out cubic. Pass `decimals` and `useCommas` to preserve original formatting.

### `HeroStat`

Splits `lines[0]` into "leading number + rest" — number rendered at 19px bold, rest as small muted suffix. Used by services-panel cards. Falls back to plain rendering if the line has no leading number.

```tsx
{up && lines[0] && <HeroStat line={lines[0]} keyPrefix={`${name}-h`} />}
```

### `TrendDelta`

Small `↑X` / `↓X` indicator next to a hero metric. Compares `current` against `history[length - lookback]` (default lookback 6 = ~60s at 10s polling).

```tsx
<TrendDelta history={cpuHistory} current={metrics.cpu} goodDirection="down" suffix="%" />
```

- `goodDirection="down"` for metrics where falling = good (CPU, temp, memory pressure)
- `goodDirection="up"` for metrics where rising = good (free RAM, throughput)
- `threshold` (default 0.1) — minimum |delta| to render
- `precision` (default 1) — decimals on the rendered delta
- **Built-in sanity guard:** suppresses output when `|delta|/|current| > 5` (catches unit-mismatch bugs like the speedtest one in `memory.md`)

### `Card` visual contract

Every metric card uses the shared `<Card>` primitive. As of the polish pass it provides automatically:
- 3px gradient accent stripe at top with colored glow
- Radial brand-color background tint
- `-3px` lift on hover with brand drop-shadow + brand inner ring
- Pulsing status dot in the header (green / amber / red, derived from `alertLevel` prop)
- `fadeSlideIn` enter animation

Just pass `accent`, `alertLevel`, `icon`, `label` and children. Don't manually re-add stripes/shadows — that's the `Card`'s job.

### Services panel cards (in `app/page.tsx`)

These don't use the shared `<Card>` (different layout) but follow the same visual treatment: gradient stripe, radial brand bg, hover glow, hero stat, status dot. See the `SVC_CATEGORIES` map for category grouping (Media Stack / Infrastructure).

## Build & deploy

The build runs on the **PC**, not in Docker. Workflow:

```powershell
# PC (PowerShell) — every code change
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
npm run build           # produces .next/ which is git-tracked
git add .next app/<changed-files>
git commit -m "..."
git push
```

```bash
# TrueNAS (bash)
/root/update-dashboard.sh
```

Why: `next build` SIGSEGVs non-deterministically inside Docker on the TrueNAS host. The Dockerfile is now runtime-only — it just installs prod deps and copies the prebuilt `.next/`. See `memory.md` → "Build moved off Docker" for the full diagnostic trail.

`.next/cache` and `.next/trace` stay gitignored — regenerable, would bloat commits. Everything else under `.next/` is tracked.

## Env vars

All credentials are server-side `process.env.*`. Never hardcoded, never `NEXT_PUBLIC_`. See `context.md` for the full table and `.env.local.example` for the template.

When adding a new credential:
1. `process.env.NEW_VAR ?? ""` in the relevant route
2. Add to `.env.local.example` with placeholder
3. Add to `.env.local` (gitignored) for local dev
4. Add `-e NEW_VAR='...'` line to `/root/update-dashboard.sh` on TrueNAS
