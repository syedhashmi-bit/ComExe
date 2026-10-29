import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// The Engine API is reached over the unix socket with node:http, so the
// request path is the contract. findContainer used to URL-encode the filters
// JSON and then request() encoded it again: the daemon got `%257B…`, rejected
// the filter, and logs/restart said "not found" for every container.

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

beforeEach(() => {
  calls.length = 0;
  containers = [{ Id: "abc123", Names: ["/radarr"], State: "running", Image: "radarr:latest" }];
});

describe("docker socket client", () => {
  it("sends the name filter as single-encoded JSON", async () => {
    const { findContainer } = await import("@/app/lib/docker");
    const c = await findContainer("radarr");
    expect(c).toMatchObject({ id: "abc123", name: "radarr", state: "running" });
    const q = new URLSearchParams(calls[0].split("?")[1]);
    expect(JSON.parse(q.get("filters")!)).toEqual({ name: ["radarr"] });
    expect(calls[0]).not.toContain("%25");
  });

  it("clamps a non-numeric tail instead of sending NaN", async () => {
    const { containerLogs } = await import("@/app/lib/docker");
    await containerLogs("radarr", Number("abc"));
    expect(calls[1]).toContain("tail=200");
    await containerLogs("radarr", 999999);
    expect(calls[3]).toContain("tail=5000");
  });
});
