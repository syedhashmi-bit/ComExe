import { describe, it, expect } from "vitest";
import { collectIssues } from "@/app/components/StatusSummary";
import type { ClientConfig, Metrics, ServiceResult } from "@/app/lib/types";

// The status summary is the dashboard's answer to "is anything wrong?", so the
// list it builds is what matters: what counts as a problem, how problems are
// grouped, and that the worst comes first.

function metrics(over: Partial<Metrics> = {}): Metrics {
  return {
    cpu: 10,
    memory: { total: 100, used: 40, available: 60, sReclaimable: 0 },
    uptime: 1000,
    disks: [],
    network: { rxBytesPerSec: 0, txBytesPerSec: 0, rxBytesTotal: 0, txBytesTotal: 0 },
    gpu: { name: null, utilization: null, memUsed: null, memTotal: null, temperature: null, powerDraw: null, powerLimit: null, coreClock: null, memClock: null, fanSpeed: null, encUtil: null, decUtil: null },
    ...over,
  } as Metrics;
}

const svc = (name: string, over: Partial<ServiceResult> = {}): ServiceResult =>
  ({ name, up: true, configured: true, lines: ["1 thing"], ...over }) as ServiceResult;

const cfg = { truenasIp: "10.0.0.2", serviceUrls: {} } as unknown as ClientConfig;

describe("StatusSummary collectIssues", () => {
  it("is empty when everything is normal", () => {
    expect(collectIssues(metrics(), [svc("radarr"), svc("sonarr")], cfg, false)).toEqual([]);
  });

  it("reports a crossed threshold with its label and value", () => {
    const [i] = collectIssues(metrics({ cpu: 97 }), [], cfg, false);
    expect(i).toMatchObject({ level: "critical", status: "Critical", subject: "CPU", detail: "97%" });
  });

  it("groups services with the same health problem into one row", () => {
    const issues = collectIssues(metrics(), [
      svc("radarr", { health: { error: 1, warning: 0, messages: ["Indexer down"] } }),
      svc("sonarr", { health: { error: 2, warning: 0 } }),
      svc("prowlarr", { health: { error: 1, warning: 0 } }),
    ], cfg, false);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ status: "Health error", subject: "Radarr, Sonarr, Prowlarr", level: "critical" });
    expect(issues[0].title).toContain("Radarr: Indexer down");
  });

  it("covers down, rejected credentials, stale data and Uptime Kuma, worst first", () => {
    const issues = collectIssues(metrics(), [
      svc("pihole", { stale: true }),
      svc("radarr", { up: false }),
      svc("sonarr", { authError: true }),
      svc("uptimekuma", { downCount: 2 }),
    ], cfg, false);
    expect(issues.map(i => i.status)).toEqual(["Down", "Auth failed", "Monitor down", "Stale"]);
    expect(issues[0].href).toBe("http://10.0.0.2:30025");
    expect(issues[1].href).toBe("/setup");
    expect(issues[2].detail).toBe("2 monitors are down.");
  });

  it("ignores services that aren't configured", () => {
    expect(collectIssues(metrics(), [svc("bazarr", { configured: false, up: false })], cfg, false)).toEqual([]);
  });

  it("reports down Prometheus exporters, except in demo mode", () => {
    const m = metrics({ scrapeDegraded: true, scrapeTargets: [{ job: "node", instance: "a", up: false }, { job: "gpu", instance: "b", up: true }] });
    expect(collectIssues(m, [], cfg, false)[0]).toMatchObject({ status: "Exporter down", subject: "node" });
    expect(collectIssues(m, [], cfg, true)).toEqual([]);
  });
});
