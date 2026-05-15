import { NextResponse } from "next/server";
import { isDockerEnabled, containerLogs } from "@/app/lib/docker";

// ── /api/docker/logs ─────────────────────────────────────────────────────────
// GET ?name=...&tail=200 → returns last N log lines from the named container.
// Same opt-in + allowlist as /api/docker/restart.

const BUILTIN_ALLOW = new Set([
  "radarr", "sonarr", "bazarr", "tautulli", "qbittorrent", "overseerr", "prowlarr",
  "pihole", "pi-hole",
  "nginx", "nginx-proxy-manager", "npm",
  "uptime-kuma", "uptimekuma",
  "grafana", "prometheus",
  "speedtracker",
  "comexe",
]);

function isAllowed(name: string): boolean {
  if (BUILTIN_ALLOW.has(name)) return true;
  const extra = (process.env.COMEXE_DOCKER_ALLOW ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return extra.includes(name);
}

export async function GET(req: Request) {
  if (!isDockerEnabled()) {
    return NextResponse.json({ ok: false, message: "Docker control disabled. Set COMEXE_DOCKER_ENABLED=1 to enable." }, { status: 403 });
  }

  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").trim();
  const tail = Math.min(2000, Math.max(10, Number(url.searchParams.get("tail") ?? "200")));

  if (!name) return NextResponse.json({ ok: false, message: "Missing ?name=" }, { status: 400 });
  if (!isAllowed(name)) return NextResponse.json({ ok: false, message: `Container "${name}" not in allowlist.` }, { status: 403 });

  try {
    const r = await containerLogs(name, tail);
    return NextResponse.json(r, { status: r.ok ? 200 : (r.status === 404 ? 404 : 500) });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Docker socket error: ${(e as Error).message}. Mount /var/run/docker.sock?` }, { status: 502 });
  }
}
