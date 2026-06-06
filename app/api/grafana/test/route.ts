import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/app/lib/http";

// ── /api/grafana/test ────────────────────────────────────────────────────────
// Server-side reachability + auth check for a Grafana panel URL. The iframe
// itself can't tell us if Grafana returned a "Forbidden" panel because the
// HTML shell loads fine — the auth check happens inside the Grafana SPA's own
// API call after JS runs. So we probe Grafana's REST API directly:
//   GET ${baseUrl}/api/dashboards/uid/${dashboardUid}
// That returns 200 when anonymous viewer is enabled (or the request is
// authenticated), 401/403 otherwise. Most reliable signal.

interface TestResult {
  ok:        boolean;
  status:    number;
  reason:    "ok" | "auth" | "not_found" | "unreachable" | "bad_url";
  hint?:     string;
}

// Pull the dashboard UID out of a Grafana embed URL.
// Examples:
//   http://host:3000/d-solo/rYdddlPWk/node-exporter-full?...   → rYdddlPWk
//   http://host:3000/d/abc123/dashboard?...                    → abc123
function extractDashboardUid(panelUrl: string): { baseUrl: string; uid: string } | null {
  try {
    const u = new URL(panelUrl);
    const m = u.pathname.match(/^\/d(?:-solo)?\/([^/]+)/);
    if (!m) return null;
    return { baseUrl: `${u.protocol}//${u.host}`, uid: m[1] };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json<TestResult>({ ok: false, status: 0, reason: "bad_url", hint: "Missing ?url=" }, { status: 400 });
  }

  const parsed = extractDashboardUid(url);
  if (!parsed) {
    return NextResponse.json<TestResult>({ ok: false, status: 0, reason: "bad_url", hint: "Could not extract /d/<uid> from the URL." });
  }

  const apiUrl = `${parsed.baseUrl}/api/dashboards/uid/${parsed.uid}`;
  try {
    const headers: Record<string, string> = {};
    if (process.env.GRAFANA_API_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GRAFANA_API_TOKEN}`;
    }
    const res = await fetchWithTimeout(apiUrl, { timeoutMs: 4000, headers });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json<TestResult>({
        ok: false, status: res.status, reason: "auth",
        hint: "Grafana refused anonymous access. The iframe will render but show 'Forbidden' inside the panel.",
      });
    }
    if (res.status === 404) {
      return NextResponse.json<TestResult>({
        ok: false, status: 404, reason: "not_found",
        hint: `Grafana returned 404 — dashboard UID '${parsed.uid}' doesn't exist on this server.`,
      });
    }
    if (res.status >= 200 && res.status < 300) {
      return NextResponse.json<TestResult>({ ok: true, status: res.status, reason: "ok" });
    }
    return NextResponse.json<TestResult>({
      ok: false, status: res.status, reason: "unreachable",
      hint: `Grafana returned HTTP ${res.status}.`,
    });
  } catch (e) {
    return NextResponse.json<TestResult>({
      ok: false, status: 0, reason: "unreachable",
      hint: `Could not reach Grafana at ${parsed.baseUrl}: ${(e as Error).message}`,
    });
  }
}
