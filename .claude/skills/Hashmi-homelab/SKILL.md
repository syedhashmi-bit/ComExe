---
name: Hashmi-homelab
description: Apply Syed Hashmi's homelab context, stack conventions, and communication preferences when answering ANY dev or infrastructure question. Use this skill broadly — whenever the user asks about code, Docker, networking, terminal commands, TrueNAS, Next.js, the homelab dashboard, or any of the running services (Plex, *arr stack, Grafana, Pi-hole, etc.). Trigger even when the user doesn't explicitly mention their setup, because their environment (TrueNAS Scale at 192.168.88.196, MikroTik router, Windows PC with Claude Code, Next.js 16 dashboard ComExe) determines the correct answer. Apply this skill for command syntax choice (PowerShell vs bash), code style (TypeScript, server-side routes), Docker patterns (docker run, --network host), and response style (concise, direct, no fluff).
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
- **ComExe** — repo `syedhashmi-bit/ComExe` (GitHub), image `ghcr.io/syedhashmi-bit/comexe:latest`
- **Stack**: Next.js 16 (App Router), React 19, TypeScript, Tailwind 3

### How ComExe runs on TrueNAS
- A TrueNAS **custom app** named `comexe` (Apps → Install via YAML; container `ix-comexe-comexe-1`)
- Settings, including every service credential, in `/root/comexe-data/config.json`, written by the `/setup` wizard
- The image is built by GitHub Actions, never on TrueNAS

### Update Workflow
1. Edit code on Windows PC (Claude Code)
2. `git push` from PC — CI tests, builds and publishes the image
3. TrueNAS: **Apps → comexe → Update** (TrueNAS checks once a day; `midclt call app.image.op.check_update 2>/dev/null || midclt call app.image.check_update` checks now)

For one-off containers the user prefers `docker run` over Docker Compose. ComExe itself is the exception: it runs as a TrueNAS app (compose YAML) so it shows and updates in Apps — the user's choice. If another service genuinely benefits from compose (multi-container with internal networking), say so explicitly and let them decide.

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
- **Node 22**, **npm** (not pnpm/yarn/bun).
- **Next.js 16 App Router** patterns — server components by default, `'use client'` only when needed.

## Terminal Command Conventions

Always state which machine the command runs on. Use a header line above each block:

````markdown
**On Windows PC (PowerShell):**
```powershell
git push origin main
```

**On TrueNAS Shell (bash):**
```bash
docker logs --tail 50 ix-comexe-comexe-1
```
````

- **Windows PC tasks** → PowerShell syntax (`$env:VAR`, `Set-Location`, backticks for line continuation, etc.)
- **TrueNAS tasks** → bash/zsh syntax (the root shell is zsh)
- **Docker commands always run on TrueNAS Shell**, never on the PC.

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

**Secrets are supplied at runtime. Never bake them into the Docker image.**

- On the PC during dev: secrets live in `.env.local` (gitignored)
- ComExe on TrueNAS: the `/setup` wizard saves them to `config.json` in the app's data folder; anything else goes under `environment:` in the app's YAML
- Other containers on TrueNAS: pass each secret via `-e VAR=value` on `docker run`
- The Dockerfile must NOT `COPY .env.local` or set secret values via `ENV`
- Public/non-secret config (e.g. port numbers) can be baked in

## Defaults to Assume

When the user doesn't specify, assume:
- They're asking about ComExe unless context says otherwise
- New widgets/features go in the ComExe repo
- Service URLs use `http://192.168.88.196:<port>` on the LAN
- Secrets are supplied at runtime (wizard config, app YAML, or `docker run -e`), not baked into the image
- Any monitoring data already has a Prometheus exporter — check before suggesting they install something new
