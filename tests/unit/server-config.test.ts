import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fs so we don't touch real disk
vi.mock("node:fs", () => ({
  promises: {
    readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockRejectedValue(new Error("ENOENT")),
  },
}));

describe("server-config", () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear all env vars that the config resolver reads
    delete process.env.TRUENAS_IP;
    delete process.env.RADARR_API_KEY;
    delete process.env.RADARR_URL;
    delete process.env.MIKROTIK_URL;
    delete process.env.MIKROTIK_USERNAME;
    delete process.env.MIKROTIK_PASSWORD;
    delete process.env.PROMETHEUS_URL;
  });

  it("uses default TrueNAS IP when no env or file", async () => {
    const { loadConfig } = await import("@/app/lib/server-config");
    const cfg = await loadConfig();
    expect(cfg.truenasIp).toBe("192.168.88.196");
  });

  it("reads TRUENAS_IP from env", async () => {
    process.env.TRUENAS_IP = "10.0.0.50";
    const { loadConfig } = await import("@/app/lib/server-config");
    const cfg = await loadConfig();
    expect(cfg.truenasIp).toBe("10.0.0.50");
  });

  it("marks services unconfigured when API key missing", async () => {
    const { loadConfig } = await import("@/app/lib/server-config");
    const cfg = await loadConfig();
    expect(cfg.services.radarr.configured).toBe(false);
    expect(cfg.services.radarr.envVar).toContain("RADARR_API_KEY");
  });

  it("marks services configured when API key set", async () => {
    process.env.RADARR_API_KEY = "test-key-123";
    const { loadConfig } = await import("@/app/lib/server-config");
    const cfg = await loadConfig();
    expect(cfg.services.radarr.configured).toBe(true);
    expect(cfg.services.radarr.apiKey).toBe("test-key-123");
  });

  it("builds service URL from TrueNAS IP + default port", async () => {
    process.env.TRUENAS_IP = "10.0.0.99";
    const { loadConfig } = await import("@/app/lib/server-config");
    const cfg = await loadConfig();
    expect(cfg.services.radarr.url).toBe("http://10.0.0.99:30025");
  });

  it("prefers explicit service URL over derived one", async () => {
    process.env.RADARR_URL = "http://my-radarr:7878";
    const { loadConfig } = await import("@/app/lib/server-config");
    const cfg = await loadConfig();
    expect(cfg.services.radarr.url).toBe("http://my-radarr:7878");
  });

  it("resolves MikroTik as unconfigured without credentials", async () => {
    const { loadConfig } = await import("@/app/lib/server-config");
    const cfg = await loadConfig();
    expect(cfg.mikrotik.configured).toBe(false);
    expect(cfg.mikrotik.envVar).toEqual(expect.arrayContaining(["MIKROTIK_USERNAME", "MIKROTIK_PASSWORD"]));
  });

  it("uses default preferences", async () => {
    const { loadConfig } = await import("@/app/lib/server-config");
    const cfg = await loadConfig();
    expect(cfg.preferences.searchEngine).toBe("google");
    expect(cfg.preferences.timezone).toBe("");
    expect(cfg.preferences.theme).toBe("midnight");
  });

  it("resolves Grafana defaults", async () => {
    const { loadConfig } = await import("@/app/lib/server-config");
    const cfg = await loadConfig();
    expect(cfg.grafana.panelId).toBe("panel-77");
    expect(cfg.grafana.dashboardSlug).toBe("node-exporter-full");
  });
});
