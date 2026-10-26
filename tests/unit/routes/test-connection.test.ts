import { describe, it, expect, beforeEach, vi } from "vitest";

// The /setup wizard never receives saved secrets, so its key fields are blank
// and Test falls back to the saved credentials. That fallback must only apply
// to the saved URL: otherwise POSTing { service, url: "http://attacker" } with
// a blank key would send the stored key to any host the caller names.

const SAVED_URL = "http://192.168.88.196:30025";
const fetchWithTimeout = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchWithTimeout.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.doMock("@/app/lib/http", () => ({ fetchWithTimeout }));
  vi.doMock("@/app/lib/server-config", () => ({
    loadConfig: async () => ({
      mikrotik: { url: "http://192.168.88.1", username: "monitor-only", password: "mp" },
      services: { radarr: { url: SAVED_URL, apiKey: "saved-radarr-key" } },
    }),
  }));
});

async function test(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/test-connection/route");
  const res = await POST(new Request("http://localhost:3000/api/test-connection", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return res.json() as Promise<{ ok: boolean; message: string }>;
}

describe("/api/test-connection — saved credential fallback", () => {
  it("uses the saved key when the field is blank and the URL is the saved one", async () => {
    const r = await test({ service: "radarr", url: `${SAVED_URL}/` });
    expect(r.ok).toBe(true);
    expect(String(fetchWithTimeout.mock.calls[0][0])).toContain("apiKey=saved-radarr-key");
  });

  it("never sends the saved key to a different URL", async () => {
    const r = await test({ service: "radarr", url: "http://attacker.example:30025" });
    expect(r).toEqual({ ok: false, message: "Missing API key" });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("prefers a typed key over the saved one", async () => {
    await test({ service: "radarr", url: SAVED_URL, apiKey: "typed" });
    expect(String(fetchWithTimeout.mock.calls[0][0])).toContain("apiKey=typed");
  });
});
