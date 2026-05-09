import { NextResponse } from "next/server";

// ── /api/test-connection ──────────────────────────────────────────────────────
// Setup-wizard helper. POST a service spec, returns whether the credentials
// can actually authenticate against the upstream. Live-only — the values aren't
// persisted anywhere on this side.
//
// Request body shape:
//   {
//     service: "radarr" | "sonarr" | ...,
//     url:     string,
//     apiKey?:   string,
//     username?: string,
//     password?: string,
//   }
//
// Response: { ok: boolean, message: string }

interface TestRequest {
  service: string;
  url:     string;
  apiKey?: string;
  username?: string;
  password?: string;
}

interface TestResult {
  ok: boolean;
  message: string;
}

const TIMEOUT = 8_000;

function fail(msg: string): TestResult { return { ok: false, message: msg }; }
function pass(msg: string): TestResult { return { ok: true,  message: msg }; }

async function testRadarr(url: string, key: string): Promise<TestResult> {
  if (!key) return fail("Missing API key");
  try {
    const r = await fetch(`${url}/api/v3/system/status?apiKey=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json" } });
    if (r.status === 401 || r.status === 403) return fail(`Unauthorized (HTTP ${r.status}) — wrong API key`);
    if (!r.ok) return fail(`HTTP ${r.status}`);
    const data = await r.json() as { version?: string; appName?: string };
    return pass(`Connected${data.version ? ` (v${data.version})` : ""}`);
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testSonarr(url: string, key: string): Promise<TestResult> {
  if (!key) return fail("Missing API key");
  try {
    const r = await fetch(`${url}/api/v3/system/status?apiKey=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json" } });
    if (r.status === 401 || r.status === 403) return fail(`Unauthorized (HTTP ${r.status}) — wrong API key`);
    if (!r.ok) return fail(`HTTP ${r.status}`);
    const data = await r.json() as { version?: string };
    return pass(`Connected${data.version ? ` (v${data.version})` : ""}`);
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testProwlarr(url: string, key: string): Promise<TestResult> {
  if (!key) return fail("Missing API key");
  try {
    const r = await fetch(`${url}/api/v1/system/status?apikey=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json" } });
    if (r.status === 401 || r.status === 403) return fail(`Unauthorized — wrong API key`);
    if (!r.ok) return fail(`HTTP ${r.status}`);
    const data = await r.json() as { version?: string };
    return pass(`Connected${data.version ? ` (v${data.version})` : ""}`);
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testBazarr(url: string, key: string): Promise<TestResult> {
  if (!key) return fail("Missing API key");
  try {
    const r = await fetch(`${url}/api/system/status`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "X-API-KEY": key, Accept: "application/json" },
    });
    if (r.status === 401 || r.status === 403) return fail(`Unauthorized — wrong API key`);
    if (!r.ok) return fail(`HTTP ${r.status}`);
    return pass("Connected");
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testTautulli(url: string, key: string): Promise<TestResult> {
  if (!key) return fail("Missing API key");
  try {
    const r = await fetch(`${url}/api/v2?apikey=${encodeURIComponent(key)}&cmd=server_status`,
      { signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json" } });
    if (!r.ok) return fail(`HTTP ${r.status}`);
    const data = await r.json() as { response?: { result?: string; message?: string } };
    if (data.response?.result === "success") return pass("Connected");
    return fail(`Tautulli returned: ${data.response?.message ?? "unknown error (likely wrong API key)"}`);
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testOverseerr(url: string, key: string): Promise<TestResult> {
  if (!key) return fail("Missing API key");
  try {
    const r = await fetch(`${url}/api/v1/status`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "X-Api-Key": key, Accept: "application/json" },
    });
    if (r.status === 401 || r.status === 403) return fail(`Unauthorized — wrong API key`);
    if (!r.ok) return fail(`HTTP ${r.status}`);
    return pass("Connected");
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testQbittorrent(url: string, user: string, pass_: string): Promise<TestResult> {
  if (!user || !pass_) return fail("Missing username or password");
  try {
    const r = await fetch(`${url}/api/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": url },
      body: new URLSearchParams({ username: user, password: pass_ }).toString(),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) return fail(`HTTP ${r.status}`);
    const text = await r.text();
    if (text.includes("Fails.")) return fail("Wrong username or password");
    if (r.headers.get("set-cookie")?.includes("SID=")) return pass("Connected");
    if (text.includes("Forbidden") || r.status === 403) return fail("IP banned (too many failed login attempts) — restart qBit container");
    return fail("Login response didn't include a session cookie");
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testPihole(url: string, password: string): Promise<TestResult> {
  if (!password) return fail("Missing password");
  try {
    const r = await fetch(`${url}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) return fail(`HTTP ${r.status} — wrong password`);
    const data = await r.json() as { session?: { sid?: string; valid?: boolean } };
    if (data.session?.sid) return pass("Connected");
    return fail("PiHole accepted the password but didn't return a session ID");
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testNginx(url: string, user: string, pass_: string): Promise<TestResult> {
  if (!user || !pass_) return fail("Missing username or password");
  try {
    const r = await fetch(`${url}/api/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: user, secret: pass_ }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (r.status === 401) return fail("Wrong email or password");
    if (!r.ok) return fail(`HTTP ${r.status}`);
    const data = await r.json() as { token?: string };
    if (data.token) return pass("Connected");
    return fail("Nginx accepted the credentials but didn't return a token");
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testUptimeKuma(url: string, key: string): Promise<TestResult> {
  // Try /metrics first — version-dependent whether it returns monitor data.
  try {
    const r = await fetch(`${url}/metrics`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (r.ok) {
      const text = await r.text();
      if (text.includes("monitor_status")) return pass("Connected via /metrics (no auth needed)");
    }
  } catch { /* fall through */ }

  // If a key is provided, try the bearer-auth status-page endpoint.
  if (key) {
    try {
      const r = await fetch(`${url}/api/status-page/heartbeat/services`,
        { signal: AbortSignal.timeout(TIMEOUT), headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
      if (r.ok) return pass("Connected via API key");
      if (r.status === 401 || r.status === 403) return fail("Unauthorized — wrong API key");
    } catch { /* fall through to generic reachability */ }
  }

  // Generic reachability — same fallback the dashboard's services route uses.
  // Means the host is up but we couldn't pull monitor data; the card will
  // render "online" without per-monitor counts.
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (r.status >= 200 && r.status < 500) {
      return pass(`Reachable, but couldn't pull monitor data (HTTP ${r.status}). Dashboard will show "online" only.`);
    }
    return fail(`HTTP ${r.status}`);
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testMikrotik(url: string, user: string, pass_: string): Promise<TestResult> {
  if (!user || !pass_) return fail("Missing username or password");
  try {
    const auth = Buffer.from(`${user}:${pass_}`, "utf8").toString("base64");
    const r = await fetch(`${url}/rest/system/resource`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (r.status === 401) return fail("Unauthorized — wrong username or password");
    if (!r.ok) return fail(`HTTP ${r.status}`);
    const data = await r.json() as { ["board-name"]?: string; version?: string };
    return pass(`Connected${data.version ? ` (RouterOS ${data.version})` : ""}`);
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

async function testSpeedtest(url: string, key: string): Promise<TestResult> {
  if (!key) return fail("Missing bearer token");
  try {
    const r = await fetch(`${url}/api/v1/results?take=1`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (r.status === 401 || r.status === 403) return fail("Unauthorized — wrong bearer token");
    if (!r.ok) return fail(`HTTP ${r.status}`);
    return pass("Connected");
  } catch (e) {
    return fail(`Could not reach ${url} — ${(e as Error).message}`);
  }
}

export async function POST(req: Request) {
  let body: TestRequest;
  try {
    body = await req.json() as TestRequest;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body" }, { status: 400 });
  }
  const { service, url, apiKey, username, password } = body;
  if (!service || !url) {
    return NextResponse.json({ ok: false, message: "service and url are required" }, { status: 400 });
  }

  const cleanUrl = url.replace(/\/+$/, "");

  let result: TestResult;
  switch (service) {
    case "radarr":      result = await testRadarr(cleanUrl, apiKey ?? "");                    break;
    case "sonarr":      result = await testSonarr(cleanUrl, apiKey ?? "");                    break;
    case "bazarr":      result = await testBazarr(cleanUrl, apiKey ?? "");                    break;
    case "tautulli":    result = await testTautulli(cleanUrl, apiKey ?? "");                  break;
    case "prowlarr":    result = await testProwlarr(cleanUrl, apiKey ?? "");                  break;
    case "overseerr":   result = await testOverseerr(cleanUrl, apiKey ?? "");                 break;
    case "qbittorrent": result = await testQbittorrent(cleanUrl, username ?? "", password ?? ""); break;
    case "pihole":      result = await testPihole(cleanUrl, password ?? "");                  break;
    case "nginx":       result = await testNginx(cleanUrl, username ?? "", password ?? "");   break;
    case "uptimekuma":  result = await testUptimeKuma(cleanUrl, apiKey ?? "");                break;
    case "mikrotik":    result = await testMikrotik(cleanUrl, username ?? "", password ?? ""); break;
    case "speedtest":   result = await testSpeedtest(cleanUrl, apiKey ?? "");                 break;
    default:            result = fail(`Unknown service: ${service}`);
  }
  return NextResponse.json(result);
}
