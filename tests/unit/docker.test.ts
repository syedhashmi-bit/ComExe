import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// The Engine API is reached over the unix socket with node:http, so the
// request path is the contract. Containers below are the ones a TrueNAS Scale
// host actually runs: apps are compose projects named "ix-<app>", each with a
// one-shot "permissions" helper beside the real container. Matching exact
// names only meant "radarr" found nothing and the allowlist refused every
// "ix-…" name, so logs and restart worked for no container at all.

const calls: string[] = [];
let containers: unknown[] = [];

vi.mock("node:http", () => ({
  default: {
    request: (opts: { path: string }, onRes: (res: EventEmitter & { statusCode: number }) => void) => {
      calls.push(opts.path);
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.destroy = () => {};
      req.end = () => {
        const res = Object.assign(new EventEmitter(), { statusCode: 200 });
        onRes(res);
        const body = opts.path.startsWith("/containers/json") ? JSON.stringify(containers) : "";
        res.emit("data", Buffer.from(body));
        res.emit("end");
      };
      return req;
    },
  },
}));

const app = (name: string, project: string, service: string, state = "running") => ({
  Id: `${name}-id`, Names: [`/${name}`], State: state, Image: `${service}:latest`,
  Labels: { "com.docker.compose.project": project, "com.docker.compose.service": service },
});

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
  process.env.COMEXE_DOCKER_ENABLED = "1";
  delete process.env.COMEXE_DOCKER_ALLOW;
  containers = [
    app("ix-radarr-permissions-1", "ix-radarr", "permissions", "exited"),
    app("ix-radarr-radarr-1", "ix-radarr", "radarr"),
    app("ix-seerr-seerr-1", "ix-seerr", "seerr"),
    app("ix-nginx-proxy-manager-npm-1", "ix-nginx-proxy-manager", "npm"),
    app("ix-uptime-kuma-uptime-kuma-1", "ix-uptime-kuma", "uptime-kuma"),
    app("ix-kavita-kavita-1", "ix-kavita", "kavita"),
    { Id: "ne-id", Names: ["/node-exporter"], State: "running", Image: "prom/node-exporter", Labels: {} },
    { Id: "cx-id", Names: ["/comexe"], State: "running", Image: "ghcr.io/syedhashmi-bit/comexe", Labels: null },
  ];
});

afterEach(() => {
  delete process.env.COMEXE_DOCKER_ENABLED;
  delete process.env.COMEXE_DOCKER_ALLOW;
});

describe("appOf", () => {
  it("names a TrueNAS app by its project, other stacks by service, plain containers by name", async () => {
    const { appOf } = await import("@/app/lib/docker");
    expect(appOf("ix-radarr-permissions-1", { "com.docker.compose.project": "ix-radarr", "com.docker.compose.service": "permissions" }))
      .toEqual({ app: "radarr", service: "permissions" });
    expect(appOf("media-sonarr-1", { "com.docker.compose.project": "media", "com.docker.compose.service": "sonarr" }))
      .toEqual({ app: "sonarr", service: "sonarr" });
    expect(appOf("node-exporter")).toEqual({ app: "node-exporter", service: null });
  });
});

describe("findContainer", () => {
  it("lists every container in one call, with no name filter", async () => {
    const { findContainer } = await import("@/app/lib/docker");
    await findContainer("radarr");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("/containers/json?all=true");
  });

  it("resolves a services-panel name to the app's main container, not its helper", async () => {
    const { findContainer } = await import("@/app/lib/docker");
    expect((await findContainer("radarr"))?.name).toBe("ix-radarr-radarr-1");
    expect((await findContainer("overseerr"))?.name).toBe("ix-seerr-seerr-1");
    expect((await findContainer("nginx"))?.name).toBe("ix-nginx-proxy-manager-npm-1");
    expect((await findContainer("uptimekuma"))?.name).toBe("ix-uptime-kuma-uptime-kuma-1");
    expect(await findContainer("sonarr")).toBeNull();
  });

  it("takes an exact container name as given", async () => {
    const { findContainer } = await import("@/app/lib/docker");
    expect((await findContainer("ix-radarr-permissions-1"))?.service).toBe("permissions");
    expect((await findContainer("/node-exporter"))?.app).toBe("node-exporter");
  });
});

describe("isAllowedContainer", () => {
  it("checks the app, so every container of an allowed app passes", async () => {
    const { isAllowedContainer } = await import("@/app/lib/docker");
    expect(isAllowedContainer({ name: "ix-radarr-permissions-1", app: "radarr" })).toBe(true);
    expect(isAllowedContainer({ name: "ix-seerr-seerr-1", app: "seerr" })).toBe(true);
    expect(isAllowedContainer({ name: "ix-kavita-kavita-1", app: "kavita" })).toBe(false);
  });

  it("extends with COMEXE_DOCKER_ALLOW, by app or container name", async () => {
    process.env.COMEXE_DOCKER_ALLOW = "kavita, my-db";
    const { isAllowedContainer } = await import("@/app/lib/docker");
    expect(isAllowedContainer({ name: "ix-kavita-kavita-1", app: "kavita" })).toBe(true);
    expect(isAllowedContainer({ name: "my-db", app: "postgres" })).toBe(true);
  });

  it("lets ComExe read its own logs but not restart itself", async () => {
    const { isAllowedContainer } = await import("@/app/lib/docker");
    expect(isAllowedContainer({ name: "comexe", app: "comexe" })).toBe(true);
    expect(isAllowedContainer({ name: "comexe", app: "comexe" }, { restart: true })).toBe(false);
  });
});

describe("containerLogs", () => {
  it("clamps a non-numeric tail instead of sending NaN", async () => {
    const { findContainer, containerLogs } = await import("@/app/lib/docker");
    const c = (await findContainer("radarr"))!;
    await containerLogs(c, Number("abc"));
    expect(calls[1]).toContain("/containers/ix-radarr-radarr-1-id/logs");
    expect(calls[1]).toContain("tail=200");
    await containerLogs(c, 999999);
    expect(calls[2]).toContain("tail=5000");
  });
});

describe("socketHint", () => {
  it("says what to add for the two usual socket failures", async () => {
    const { socketHint } = await import("@/app/lib/docker");
    const err = (code: string) => Object.assign(new Error(`connect ${code} /var/run/docker.sock`), { code });
    expect(socketHint(err("EACCES"))).toMatch(/--group-add/);
    expect(socketHint(err("ENOENT"))).toMatch(/-v \/var\/run\/docker\.sock/);
    expect(socketHint(new Error("boom"))).toBe("Docker socket error: boom");
  });
});

describe("/api/docker routes", () => {
  it("logs: a services-panel name reaches the TrueNAS container", async () => {
    const { GET } = await import("@/app/api/docker/logs/route");
    const res = await GET(new Request("http://x/api/docker/logs?name=radarr&tail=50"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, container: "ix-radarr-radarr-1" });
  });

  it("logs: a container outside the allowlist is refused, naming what to add", async () => {
    const { GET } = await import("@/app/api/docker/logs/route");
    const res = await GET(new Request("http://x/api/docker/logs?name=ix-kavita-kavita-1"));
    expect(res.status).toBe(403);
    expect((await res.json()).message).toContain(`Add "kavita" to COMEXE_DOCKER_ALLOW`);
    expect(calls.some(p => p.includes("/logs"))).toBe(false);
  });

  it("logs: unknown name is a 404, disabled is a 403", async () => {
    const { GET } = await import("@/app/api/docker/logs/route");
    expect((await GET(new Request("http://x/api/docker/logs?name=sonarr"))).status).toBe(404);
    delete process.env.COMEXE_DOCKER_ENABLED;
    expect((await GET(new Request("http://x/api/docker/logs?name=radarr"))).status).toBe(403);
  });

  it("containers: offers only allowed containers and names the rest", async () => {
    const { GET } = await import("@/app/api/docker/containers/route");
    const body = await (await GET()).json();
    const names = body.containers.map((c: { name: string }) => c.name);
    expect(names).toContain("ix-radarr-radarr-1");
    expect(names).toContain("node-exporter");
    expect(names).not.toContain("ix-kavita-kavita-1");
    expect(body.hidden).toEqual(["kavita"]);
    expect(body.containers.find((c: { name: string }) => c.name === "ix-seerr-seerr-1")).toMatchObject({ app: "seerr", service: "seerr" });
  });

  it("containers: says Docker is disabled so the page can show setup", async () => {
    delete process.env.COMEXE_DOCKER_ENABLED;
    const { GET } = await import("@/app/api/docker/containers/route");
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ disabled: true });
  });

  it("restart: resolves the app, and ComExe can't restart itself", async () => {
    const { POST } = await import("@/app/api/docker/restart/route");
    const post = (name: string) => POST(new Request("http://x/api/docker/restart", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    }));
    const ok = await post("overseerr");
    expect(ok.status).toBe(200);
    expect(calls).toContain("/containers/ix-seerr-seerr-1-id/restart?t=10");
    expect((await post("comexe")).status).toBe(403);
  });
});
