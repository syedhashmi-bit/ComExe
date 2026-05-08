---
name: Hashmi-homelab
description: Apply Syed Hashmi's homelab context, stack conventions, and communication preferences when answering ANY dev or infrastructure question. Use this skill broadly — whenever the user asks about code, Docker, networking, terminal commands, TrueNAS, Next.js, the homelab dashboard, or any of the running services (Plex, *arr stack, Grafana, Pi-hole, etc.). Trigger even when the user doesn't explicitly mention their setup, because their environment (TrueNAS Scale at 192.168.88.196, MikroTik router, Windows PC with Claude Code, Next.js 15 dashboard) determines the correct answer. Apply this skill for command syntax choice (PowerShell vs bash), code style (TypeScript, server-side routes), Docker patterns (docker run, --network host), and response style (concise, direct, no fluff).
---

# Hashmi Homelab Context

This skill captures the user's homelab environment, stack conventions, and communication preferences. Apply it on every dev/infra question — even short ones.

## The Environment

### Hardware & Network
- **TrueNAS Scale server**: `192.168.88.196`
  - Intel Xeon E5-2680 v4 (28 cores), 63 GB RAM
  - NVIDIA GTX 1660 SUPER GPU (available for transcoding / compute)
- **MikroTik hAP ax³ router**: `192.168.88.1`
- **Windows PC**: development machine, runs Claude Code in PowerShell
- **Network**: flat `192.168.88.0/24`, local-only access for now (Cloudflare Tunnel planned)

### Primary Project
- **Repo**: `syedhashmi-bit/homelab-dashboard` (GitHub)
- **Stack**: Next.js 15, T

### Paths
- **Dashboard repo on TrueNAS**: `/mnt/Pool/Media/homelab-dashboard`
- **Update script on TrueNAS**: `/root/update-dashboard.sh` (wraps `git pull` + docker rebuild)

### Update Workflow
1. Edit code on Windows PC (Claude Code)
2. `git push` from PC
3. SSH / open TrueNAS Shell
4. Run `/root/update-dashboard.sh`

Never suggest Docker Compose for the dashboard or other one-off containers — the user prefers `docker run`. If a service genuinely benefits from compose (multi-container with internal networking), say so explicitly and let them decide.

### Running Services on TrueNAS
Media: Plex, Radarr, Sonarr, Bazarr, Tautulli, Prowlarr, qBittorrent, Overseerr, Cleanuparr
Network/Infra: Pi-hole, Nginx Proxy Manager, Uptime Kuma
Monitoring: Grafana, Prometheus, node-exporter, nvidia-gpu-exporter, SpeedTracker, Glances
Dashboard aggregator: Homepage

When the user mentions any of these by name, assume it's already running on TrueNAS and skip "you'll need to install X" preamble.

### Monitoring details (confirmed)

**NVIDIA GPU exporter**: `utkuozdemir/nvidia_gpu_exporter:1.2.0` on port `9835`.

Confirmed working metrics and their conversions:

| Metric | Unit | Conversion |
|---|---|---|
| `nvidia_smi_utilization_gpu_ratio` | 0–1 ratio | multiply by 100 for % |
| `nvidia_smi_temperature_gpu` | Celsius | use directly |
| `nvidia_smi_memory_used_bytes` | bytes | divide by 1073741824 for GB |
| `nvidia_smi_memory_total_bytes` | bytes | divide by 1073741824 for GB |
| `nvidia_smi_power_draw_watts` | watts | use directly |
| `nvidia_smi_power_limit_watts` | watts | use directly |

Use these exact metric names in PromQL — do not invent variations.

## Code Conventions

- **Always TypeScript.** Never plain JavaScript unless the user explicitly asks.
- **Sensitive credentials → server-side Next.js API routes** (`app/api/.../route.ts`). Never put API keys, tokens, or service URLs with auth in client components or `NEXT_PUBLIC_*` env vars.
- **Comments in code blocks** should be brief and explain *why*, not *what*.
- **Node 20**, **npm** (not pnpm/yarn/bun).
- **Next.js 15 App Router** patterns — server components by default, `'use client'` only when needed.

## Terminal Command Conventions

Always state which machine the command runs on. Use a header line above each block:

````markdown
**On Windows PC (PowerShell):**
```powershell
git push origin main
```

**On TrueNAS Shell (bash):**
```bash
/root/update-dashboard.sh
```
````

- **Windows PC tasks** → PowerShell syntax (`$env:VAR`, `Set-Location`, backticks for line continuation, etc.)
- **TrueNAS tasks** → bash/zsh syntax
- **Docker commands always run on TrueNAS Shell**, never on the PC.

For the dashboard specifically, the canonical rebuild command on TrueNAS is:
```bash
docker stop homelab-dashboard 2>/dev/null
docker rm homelab-dashboard 2>/dev/null
cd /mnt/Pool/Media/homelab-dashboard && git pull
docker build -t homelab-dashboard .
docker run -d --name homelab-dashboard --network host --restart unless-stopped \
  -e PLEX_TOKEN=xxx \
  -e SONARR_API_KEY=xxx \
  homelab-dashboard
```
(But the user usually just runs `/root/update-dashboard.sh` which wraps this.)

## Communication Style

- **Concise and direct.** Skip preamble like "Great question!" or "Here's how you can do that:".
- **No unnecessary explanation.** If the user asks for a command, give the command. Add a one-line note only if there's a real gotcha.
- **Short focused prompts when generating prompts for Claude Code.** Claude Code works best with one clear task per prompt — not multi-step essays.
- **Code blocks should have clear, minimal comments.**
- **No "let me know if you need anything else" sign-offs.**

## When Asked for a Claude Code Prompt

The user sometimes asks "give me a Claude Code prompt to do X." In that case, output a single short prompt block — focused on one task, with file paths if relevant, and no extra narration around it. Example shape:

```
Edit app/api/plex/route.ts to add a new GET endpoint that returns
currently-playing sessions from the Plex API at
http://192.168.88.196:32400. Use the PLEX_TOKEN env var. Return
JSON with title, user, and progress percentage.
```

## Secrets & Env Vars

**Always inject secrets at `docker run` time using `-e` flags. Never bake secrets into the Docker image.**

- On the PC during dev: secrets live in `.env.local` (gitignored)
- On TrueNAS at runtime: pass each secret via `-e VAR=value` on `docker run`
- The Dockerfile must NOT `COPY .env.local` or set secret values via `ENV`
- Public/non-secret config (e.g. `NEXT_PUBLIC_*`, port numbers) can be baked in

Example:
```bash
docker run -d --name homelab-dashboard --network host --restart unless-stopped \
  -e PLEX_TOKEN=xxx \
  -e SONARR_API_KEY=xxx \
  -e RADARR_API_KEY=xxx \
  homelab-dashboard
```

The `/root/update-dashboard.sh` script holds the actual values and is the source of truth — when adding a new secret, it must be added there.

## Defaults to Assume

When the user doesn't specify, assume:
- They're asking about the homelab dashboard project unless context says otherwise
- New widgets/features go in the dashboard repo
- Service URLs use `http://192.168.88.196:<port>` on the LAN
- Secrets are injected via `-e` on `docker run`, not baked into the image
- Any monitoring data already has a Prometheus exporter — check before suggesting they install something new
