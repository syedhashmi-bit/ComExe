import { NextResponse } from "next/server";
import { isJsonContentType, isNonEmptyString } from "@/app/lib/validate";
import { createJsonStore } from "@/app/lib/json-store";

export const dynamic = "force-dynamic";

interface DependencyEdge {
  from: string;
  to: string;
  label?: string;
}

// Falls back to the default *arr graph when the file is absent.

// Default dependency graph for a typical *arr + media stack
const DEFAULT_DEPS: DependencyEdge[] = [
  { from: "sonarr",      to: "prowlarr",     label: "indexers" },
  { from: "sonarr",      to: "qbittorrent",  label: "downloads" },
  { from: "radarr",      to: "prowlarr",     label: "indexers" },
  { from: "radarr",      to: "qbittorrent",  label: "downloads" },
  { from: "bazarr",      to: "sonarr",       label: "series data" },
  { from: "bazarr",      to: "radarr",       label: "movie data" },
  { from: "overseerr",   to: "sonarr",       label: "requests" },
  { from: "overseerr",   to: "radarr",       label: "requests" },
  { from: "tautulli",    to: "plex",         label: "monitoring" },
  { from: "nginx",       to: "overseerr",    label: "proxy" },
];

const store = createJsonStore<DependencyEdge[]>("dependencies.json", () => DEFAULT_DEPS);
const loadDeps = () => store.read();
const saveDeps = (deps: DependencyEdge[]) => store.write(deps);

export async function GET() {
  const deps = await loadDeps();
  return NextResponse.json({ dependencies: deps });
}

export async function POST(req: Request) {
  if (!isJsonContentType(req)) {
    return NextResponse.json({ ok: false, message: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: { from?: unknown; to?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const { from, to, label } = body;
    if (!isNonEmptyString(from, 100) || !isNonEmptyString(to, 100)) {
      return NextResponse.json({ ok: false, message: "from and to required (non-empty strings ≤100 chars)" }, { status: 400 });
    }
    if (label !== undefined && !isNonEmptyString(label, 100)) {
      return NextResponse.json({ ok: false, message: "label must be a non-empty string ≤100 chars" }, { status: 400 });
    }
    const deps = await loadDeps();
    if (deps.some(d => d.from === from && d.to === to)) {
      return NextResponse.json({ ok: false, message: "Dependency already exists" }, { status: 409 });
    }
    deps.push({ from, to, label: label || undefined });
    await saveDeps(deps);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error)?.message ?? "unknown error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (!from || !to) return NextResponse.json({ ok: false, message: "from and to required" }, { status: 400 });
    const deps = await loadDeps();
    const filtered = deps.filter(d => !(d.from === from && d.to === to));
    await saveDeps(filtered);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error)?.message ?? "unknown error" }, { status: 500 });
  }
}
