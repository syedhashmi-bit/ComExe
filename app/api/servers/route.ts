import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { promScalar } from "@/app/lib/prometheus";
import { isNonEmptyString, isHttpUrl } from "@/app/lib/validate";

export const dynamic = "force-dynamic";

interface ServerEntry {
  id: string;
  name: string;
  prometheusUrl: string;
  enabled: boolean;
}

interface ServerStatus extends ServerEntry {
  reachable: boolean;
  cpu: number | null;
  memPct: number | null;
  uptime: number | null;
  lastChecked: number;
}

const SERVERS_PATH = path.join(process.cwd(), "data", "servers.json");

async function loadServers(): Promise<ServerEntry[]> {
  try {
    const raw = await readFile(SERVERS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveServers(servers: ServerEntry[]): Promise<void> {
  await mkdir(path.dirname(SERVERS_PATH), { recursive: true });
  await writeFile(SERVERS_PATH, JSON.stringify(servers, null, 2), "utf-8");
}

async function checkServer(server: ServerEntry): Promise<ServerStatus> {
  if (!server.enabled) {
    return { ...server, reachable: false, cpu: null, memPct: null, uptime: null, lastChecked: Date.now() };
  }

  try {
    const [cpu, memTotal, memAvail, uptime] = await Promise.all([
      promScalar(server.prometheusUrl, '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)'),
      promScalar(server.prometheusUrl, 'node_memory_MemTotal_bytes'),
      promScalar(server.prometheusUrl, 'node_memory_MemAvailable_bytes'),
      promScalar(server.prometheusUrl, 'node_time_seconds - node_boot_time_seconds'),
    ]);

    const memPct = memTotal != null && memAvail != null
      ? Math.round(((memTotal - memAvail) / memTotal) * 100)
      : null;

    return {
      ...server,
      reachable: true,
      cpu: cpu != null ? Math.round(cpu * 10) / 10 : null,
      memPct,
      uptime: uptime != null ? Math.round(uptime) : null,
      lastChecked: Date.now(),
    };
  } catch {
    return { ...server, reachable: false, cpu: null, memPct: null, uptime: null, lastChecked: Date.now() };
  }
}

export async function GET() {
  const servers = await loadServers();
  const statuses = await Promise.all(servers.map(checkServer));
  return NextResponse.json({ servers: statuses });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, prometheusUrl } = body;
    if (!isNonEmptyString(name)) {
      return NextResponse.json({ ok: false, message: "name required (non-empty string ≤200 chars)" }, { status: 400 });
    }
    if (!isHttpUrl(prometheusUrl)) {
      return NextResponse.json({ ok: false, message: "prometheusUrl required (http/https URL)" }, { status: 400 });
    }

    const servers = await loadServers();
    const id = `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    servers.push({ id, name: name.trim(), prometheusUrl, enabled: true });
    await saveServers(servers);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, message: "id required" }, { status: 400 });

    const servers = await loadServers();
    const filtered = servers.filter(s => s.id !== id);
    await saveServers(filtered);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, name, prometheusUrl, enabled } = body;
    if (!id) return NextResponse.json({ ok: false, message: "id required" }, { status: 400 });

    const servers = await loadServers();
    const idx = servers.findIndex(s => s.id === id);
    if (idx < 0) return NextResponse.json({ ok: false, message: "not found" }, { status: 404 });

    // Whitelist mutable fields — never spread arbitrary client keys onto the
    // persisted entry (would let a caller inject/overwrite id or unknown props).
    const next = { ...servers[idx] };
    if (name !== undefined) {
      if (!isNonEmptyString(name)) return NextResponse.json({ ok: false, message: "name must be a non-empty string ≤200 chars" }, { status: 400 });
      next.name = name.trim();
    }
    if (prometheusUrl !== undefined) {
      if (!isHttpUrl(prometheusUrl)) return NextResponse.json({ ok: false, message: "prometheusUrl must be an http/https URL" }, { status: 400 });
      next.prometheusUrl = prometheusUrl;
    }
    if (enabled !== undefined) {
      if (typeof enabled !== "boolean") return NextResponse.json({ ok: false, message: "enabled must be a boolean" }, { status: 400 });
      next.enabled = enabled;
    }
    servers[idx] = next;
    await saveServers(servers);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}
