import { NextResponse } from "next/server";
import { isDockerEnabled, restartContainer } from "@/app/lib/docker";

// ── /api/docker/restart ──────────────────────────────────────────────────────
// POST { name } → restarts the named container via the Docker socket.
// Disabled unless COMEXE_DOCKER_ENABLED=1 because the socket is root-equivalent
// and we don't want it to do anything by accident.
//
// Allowlist: only the configured service names (radarr, sonarr, etc.) plus
// optional comexe-managed containers via COMEXE_DOCKER_ALLOW. Reject anything
// else so a compromised dashboard can't trigger restarts on, say, a database
// container the user mounted the socket alongside.

const BUILTIN_ALLOW = new Set([
  "radarr", "sonarr", "bazarr", "tautulli", "qbittorrent", "overseerr", "prowlarr",
  "pihole",   // pi-hole names vary by image
  "pi-hole",
  "nginx", "nginx-proxy-manager", "npm",
  "uptime-kuma", "uptimekuma",
  "grafana", "prometheus",
  "speedtracker",
]);

function isAllowed(name: string): boolean {
  if (BUILTIN_ALLOW.has(name)) return true;
  const extra = (process.env.COMEXE_DOCKER_ALLOW ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return extra.includes(name);
}

export async function POST(req: Request) {
  if (!isDockerEnabled()) {
    return NextResponse.json({ ok: false, message: "Docker control disabled. Set COMEXE_DOCKER_ENABLED=1 to enable." }, { status: 403 });
  }

  let body: { name?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 }); }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, message: "Missing `name`" }, { status: 400 });
  }
  if (!isAllowed(name)) {
    return NextResponse.json({ ok: false, message: `Container "${name}" not in allowlist. Add to COMEXE_DOCKER_ALLOW to permit.` }, { status: 403 });
  }

  try {
    const r = await restartContainer(name);
    return NextResponse.json(r, { status: r.ok ? 200 : (r.status === 404 ? 404 : 500) });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Docker socket error: ${(e as Error).message}. Mount /var/run/docker.sock?` }, { status: 502 });
  }
}
