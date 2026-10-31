import { NextResponse } from "next/server";
import { isJsonContentType } from "@/app/lib/validate";
import { isDockerEnabled, restartContainer, findContainer, isAllowedContainer, socketHint } from "@/app/lib/docker";

// ── /api/docker/restart ──────────────────────────────────────────────────────
// POST { name } → restarts the named container via the Docker socket.
// Disabled unless COMEXE_DOCKER_ENABLED=1 because the socket is root-equivalent
// and we don't want it to do anything by accident.
//
// Allowlist (lib/docker.ts): only the known service apps (radarr, sonarr, etc.)
// plus COMEXE_DOCKER_ALLOW, checked against the container the name resolves
// to. Reject anything else so a compromised dashboard can't trigger restarts
// on, say, a database container the user mounted the socket alongside.

export async function POST(req: Request) {
  if (!isJsonContentType(req)) {
    return NextResponse.json({ ok: false, message: "Content-Type must be application/json" }, { status: 415 });
  }
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

  try {
    const c = await findContainer(name);
    if (!c) return NextResponse.json({ ok: false, message: `No container found for "${name}".` }, { status: 404 });
    if (!isAllowedContainer(c, { restart: true })) {
      return NextResponse.json({ ok: false, message: `"${c.name}" isn't in the allowlist. Add "${c.app}" to COMEXE_DOCKER_ALLOW to permit.` }, { status: 403 });
    }
    const r = await restartContainer(c);
    return NextResponse.json(r, { status: r.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: socketHint(e) }, { status: 502 });
  }
}
