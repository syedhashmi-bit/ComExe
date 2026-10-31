import { NextResponse } from "next/server";
import { isDockerEnabled, isAllowedContainer, listContainers, socketHint } from "@/app/lib/docker";

export const dynamic = "force-dynamic";

// ── /api/docker/containers ───────────────────────────────────────────────────
// The containers the Logs page can open: only allowlisted ones. It used to
// list every container, so most of the picker answered 403 when chosen. The
// rest are counted by app name so the page can say how to add them.

export async function GET() {
  if (!isDockerEnabled()) {
    return NextResponse.json({ ok: false, disabled: true, containers: [], message: "Docker control disabled" }, { status: 403 });
  }

  try {
    const all = await listContainers();
    const containers = all.filter(c => isAllowedContainer(c)).map(c => ({
      id: c.id.slice(0, 12), name: c.name, app: c.app, service: c.service,
      image: c.image, state: c.state, status: c.status, created: c.created,
    }));
    const hidden = [...new Set(all.filter(c => !isAllowedContainer(c)).map(c => c.app))].sort();
    return NextResponse.json({ ok: true, containers, hidden });
  } catch (e) {
    return NextResponse.json({ ok: false, containers: [], message: socketHint(e) }, { status: 502 });
  }
}
