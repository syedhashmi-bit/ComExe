// ── Docker socket client ─────────────────────────────────────────────────────
// Minimal Engine API client over the unix socket. Opt-in via the
// COMEXE_DOCKER_ENABLED=1 env var; we never touch the socket otherwise so
// the dashboard works fine on hosts where it isn't mounted.
//
// Security note: the Docker socket is root-equivalent. The /api/docker/*
// routes enforce an allowlist (only the configured service names) so an
// attacker who reaches the dashboard can't read or restart arbitrary
// containers. That's not a substitute for putting the dashboard behind auth
// before exposing it.

import http from "node:http";

const DOCKER_SOCK = process.env.DOCKER_SOCK ?? "/var/run/docker.sock";

export function isDockerEnabled(): boolean {
  return process.env.COMEXE_DOCKER_ENABLED === "1" || process.env.COMEXE_DOCKER_ENABLED === "true";
}

function request(opts: { method: string; path: string; query?: Record<string, string | number | boolean> }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const qs = opts.query
      ? "?" + Object.entries(opts.query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
      : "";
    const req = http.request({
      socketPath: DOCKER_SOCK,
      method:     opts.method,
      path:       opts.path + qs,
      headers:    { Accept: "application/json" },
      timeout:    10_000,
    }, res => {
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(typeof c === "string" ? Buffer.from(c) : c));
      res.on("end",  ()  => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error",   reject);
    req.on("timeout", () => { req.destroy(new Error("docker socket timeout")); });
    req.end();
  });
}

// What a socket failure means, for whoever reads it in the UI. The image runs
// as uid 1001, so a mounted socket it can't open is the usual first failure.
export function socketHint(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  if (err?.code === "ENOENT") return `No Docker socket at ${DOCKER_SOCK}. Mount it into the container: -v /var/run/docker.sock:/var/run/docker.sock`;
  if (err?.code === "EACCES") return `ComExe can't open ${DOCKER_SOCK}. The container runs as uid 1001: add --group-add with the socket's group id (stat -c %g ${DOCKER_SOCK}).`;
  return `Docker socket error: ${err?.message ?? String(e)}`;
}

export interface Container {
  id:      string;
  name:    string;
  app:     string;          // what the allowlist and the services panel call it
  service: string | null;   // compose service, e.g. "radarr" or "permissions"
  image:   string;
  state:   string;
  status:  string;
  created: number;
}

// TrueNAS Scale runs each app as a compose project named "ix-<app>": Radarr is
// "ix-radarr-radarr-1", beside one-shot helpers like "ix-radarr-permissions-1".
// Matching only exact container names meant "radarr" found nothing and the
// allowlist turned away every real name. Other compose stacks are known by
// their service name, plain containers by their own.
export function appOf(name: string, labels: Record<string, string> = {}): { app: string; service: string | null } {
  const project = labels["com.docker.compose.project"] ?? "";
  const service = labels["com.docker.compose.service"] || null;
  if (project.startsWith("ix-")) return { app: project.slice(3), service };
  return { app: service ?? name, service };
}

interface RawContainer { Id: string; Names?: string[]; Image?: string; State?: string; Status?: string; Created?: number; Labels?: Record<string, string> | null }

export async function listContainers(): Promise<Container[]> {
  const r = await request({ method: "GET", path: "/containers/json", query: { all: "true" } });
  if (r.status !== 200) throw new Error(r.body.trim() || `Docker API answered HTTP ${r.status}`);
  return (JSON.parse(r.body) as RawContainer[]).map(c => {
    const name = c.Names?.[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
    return {
      id: c.Id, name, ...appOf(name, c.Labels ?? {}),
      image: c.Image ?? "", state: c.State ?? "", status: c.Status ?? "", created: c.Created ?? 0,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Allowlist ────────────────────────────────────────────────────────────────
// The services the dashboard knows about, by app name. Restart leaves out
// ComExe itself. COMEXE_DOCKER_ALLOW (comma-separated app or container names)
// extends both.
const BUILTIN_ALLOW = new Set([
  "radarr", "sonarr", "bazarr", "tautulli", "qbittorrent", "prowlarr",
  "overseerr", "seerr", "jellyseerr",
  "plex",
  "pihole", "pi-hole",
  "nginx", "nginx-proxy-manager", "npm",
  "uptime-kuma", "uptimekuma",
  "grafana", "prometheus", "node-exporter",
  "speedtracker", "speedtest-tracker",
  "comexe",
]);

export function isAllowedContainer(c: Pick<Container, "name" | "app">, opts: { restart?: boolean } = {}): boolean {
  const extra = (process.env.COMEXE_DOCKER_ALLOW ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return [c.app, c.name].some(n =>
    extra.includes(n) || (BUILTIN_ALLOW.has(n) && !(opts.restart && n === "comexe")));
}

// Services-panel names whose app goes by something else.
const APP_ALIASES: Record<string, string[]> = {
  overseerr:  ["overseerr", "seerr", "jellyseerr"],
  nginx:      ["nginx-proxy-manager", "nginx", "npm"],
  uptimekuma: ["uptime-kuma", "uptimekuma"],
  pihole:     ["pihole", "pi-hole"],
};

const HELPER = /^(permissions|init|upgrade|migrat)/;

// The container a name refers to: an exact container name first (the Logs
// page sends those), else the main container of that app (the services panel
// sends "radarr" or "overseerr", not "ix-seerr-seerr-1"). Pure.
export function pickContainer(list: Container[], name: string): Container | null {
  const want = name.replace(/^\//, "");
  const exact = list.find(c => c.name === want);
  if (exact) return exact;
  const apps = APP_ALIASES[want] ?? [want];
  const score = (c: Container) =>
    (c.state === "running" ? 4 : 0) +
    (c.service == null || c.service === c.app || apps.includes(c.service) ? 2 : 0) +
    (c.service && HELPER.test(c.service) ? 0 : 1);
  return list.filter(c => apps.includes(c.app)).sort((a, b) => score(b) - score(a))[0] ?? null;
}

export async function findContainer(name: string): Promise<Container | null> {
  return pickContainer(await listContainers(), name);
}

export async function restartContainer(c: Container): Promise<{ ok: boolean; status: number; message: string }> {
  const r = await request({ method: "POST", path: `/containers/${c.id}/restart`, query: { t: 10 } });
  if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, message: `Restarted ${c.name}` };
  return { ok: false, status: r.status, message: r.body || `Restart failed (HTTP ${r.status})` };
}

// Docker logs are a multiplexed stream (stdout + stderr interleaved with an
// 8-byte header per chunk: [stream-type, 0, 0, 0, big-endian length]).
// When we ask for tty=false (default), we need to strip those headers.
// Easier path: include the `tty=true` query but containers we care about
// rarely run with TTY. Use the proper demux.
function demuxDockerLog(buf: Buffer): string {
  let i = 0;
  const parts: string[] = [];
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    const start = i + 8;
    const end = start + len;
    if (end > buf.length) break;
    parts.push(buf.toString("utf8", start, end));
    i = end;
  }
  // Fallback for TTY containers (no headers): return the raw text
  if (parts.length === 0) return buf.toString("utf8");
  return parts.join("");
}

export async function containerLogs(c: Container, tail = 200): Promise<{ ok: boolean; status: number; logs?: string; message?: string; container?: string }> {
  // A non-numeric ?tail= used to reach the daemon as `tail=NaN`.
  const lines = Number.isFinite(tail) ? Math.min(Math.max(Math.trunc(tail), 1), 5000) : 200;
  return new Promise(resolve => {
    const path = `/containers/${c.id}/logs?stdout=true&stderr=true&tail=${lines}&timestamps=true`;
    const req = http.request({
      socketPath: DOCKER_SOCK,
      method:     "GET",
      path,
      timeout:    8_000,
    }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, logs: demuxDockerLog(buf), container: c.name });
        } else {
          resolve({ ok: false, status: res.statusCode ?? 0, message: buf.toString("utf8") || "Logs fetch failed" });
        }
      });
    });
    req.on("error",   e => resolve({ ok: false, status: 0, message: socketHint(e) }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0, message: "docker socket timeout" }); });
    req.end();
  });
}
