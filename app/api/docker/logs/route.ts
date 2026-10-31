import { NextResponse } from "next/server";
import { isDockerEnabled, containerLogs, findContainer, isAllowedContainer, socketHint } from "@/app/lib/docker";

// ── /api/docker/logs ─────────────────────────────────────────────────────────
// GET ?name=...&tail=200 → returns last N log lines from the named container.
// The name is a container name (the Logs page) or an app name ("radarr", from
// the services panel). Same opt-in + allowlist as /api/docker/restart.

export async function GET(req: Request) {
  if (!isDockerEnabled()) {
    return NextResponse.json({ ok: false, message: "Docker control disabled. Set COMEXE_DOCKER_ENABLED=1 to enable." }, { status: 403 });
  }

  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").trim();
  const tail = Math.min(2000, Math.max(10, Number(url.searchParams.get("tail") ?? "200")));

  if (!name) return NextResponse.json({ ok: false, message: "Missing ?name=" }, { status: 400 });

  try {
    const c = await findContainer(name);
    if (!c) return NextResponse.json({ ok: false, message: `No container found for "${name}".` }, { status: 404 });
    if (!isAllowedContainer(c)) {
      return NextResponse.json({ ok: false, message: `"${c.name}" isn't in the allowlist. Add "${c.app}" to COMEXE_DOCKER_ALLOW to permit.` }, { status: 403 });
    }
    const r = await containerLogs(c, tail);
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: socketHint(e) }, { status: 502 });
  }
}
