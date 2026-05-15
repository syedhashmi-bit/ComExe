// ── Docker socket client ─────────────────────────────────────────────────────
// Minimal Engine API client over the unix socket. Opt-in via the
// COMEXE_DOCKER_ENABLED=1 env var; we never touch the socket otherwise so
// the dashboard works fine on hosts where it isn't mounted.
//
// Security note: the Docker socket is root-equivalent. The /api/docker/*
// routes enforce a container-name allowlist (only the configured service
// names) so an attacker who reaches the dashboard can't `exec` into arbitrary
// containers or pull arbitrary images. That's not a substitute for putting
// the dashboard behind auth before exposing it.

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

// Engine API "name" filter requires exact match including leading slash, but
// most users think of the container by its bare name. Match either form.
export async function findContainer(name: string): Promise<{ id: string; name: string; state: string; image: string } | null> {
  const trimmed = name.replace(/^\//, "");
  const filters = encodeURIComponent(JSON.stringify({ name: [trimmed] }));
  const r = await request({ method: "GET", path: "/containers/json", query: { all: "true", filters } });
  if (r.status !== 200) return null;
  const list = JSON.parse(r.body) as Array<{ Id: string; Names: string[]; State: string; Image: string }>;
  // /containers/json name filter is substring — narrow to exact match
  for (const c of list) {
    if (c.Names.some(n => n.replace(/^\//, "") === trimmed)) {
      return { id: c.Id, name: c.Names[0]?.replace(/^\//, "") ?? trimmed, state: c.State, image: c.Image };
    }
  }
  return null;
}

export async function restartContainer(name: string): Promise<{ ok: boolean; status: number; message: string }> {
  const c = await findContainer(name);
  if (!c) return { ok: false, status: 404, message: `Container "${name}" not found` };
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

export async function containerLogs(name: string, tail = 200): Promise<{ ok: boolean; status: number; logs?: string; message?: string }> {
  const c = await findContainer(name);
  if (!c) return { ok: false, status: 404, message: `Container "${name}" not found` };
  return new Promise(resolve => {
    const path = `/containers/${c.id}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=true`;
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
          resolve({ ok: true, status: res.statusCode, logs: demuxDockerLog(buf) });
        } else {
          resolve({ ok: false, status: res.statusCode ?? 0, message: buf.toString("utf8") || "Logs fetch failed" });
        }
      });
    });
    req.on("error",   e => resolve({ ok: false, status: 0, message: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0, message: "docker socket timeout" }); });
    req.end();
  });
}
