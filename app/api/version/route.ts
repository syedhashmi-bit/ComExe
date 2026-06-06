import { NextResponse } from "next/server";
import { fetchJson } from "@/app/lib/http";
import { createTTLCache } from "@/app/lib/cache";

// ── /api/version ─────────────────────────────────────────────────────────────
// Reports the running image's git SHA (baked at Docker build time via
// COMEXE_GIT_SHA build-arg) and compares to the latest commit on
// syedhashmi-bit/ComExe@main via the GitHub REST API. The frontend uses
// `hasUpdate` to render a small "update available" banner.
//
// Cached server-side for 30 min so we never blow the GitHub unauthenticated
// rate limit (60 req/hr per IP) even if a hundred browsers poll.

interface VersionInfo {
  current:    string;  // SHA baked into the image, or "dev" when missing
  latest:     string | null;
  hasUpdate:  boolean;
  fetchedAt:  number;
  repoUrl:    string;
}

const cache = createTTLCache<VersionInfo>(30 * 60 * 1000);
const REPO_API  = "https://api.github.com/repos/syedhashmi-bit/ComExe/commits/main";
const REPO_URL  = "https://github.com/syedhashmi-bit/ComExe";

export async function GET() {
  const current = process.env.COMEXE_GIT_SHA?.trim() || "dev";

  const cached = cache.get();
  if (cached) return NextResponse.json(cached);

  // Swallowed on failure — the banner just won't show.
  const body = await fetchJson<{ sha?: string }>(REPO_API, {
    timeoutMs: 4000,
    headers: { Accept: "application/vnd.github+json" },
  });
  const latest: string | null = typeof body?.sha === "string" ? body.sha : null;

  // Compare on first 7 chars — the short SHA. Same convention as `git log
  // --oneline` and what the banner displays.
  const cur7 = current.slice(0, 7);
  const lat7 = latest ? latest.slice(0, 7) : null;
  const hasUpdate = current !== "dev" && lat7 != null && cur7 !== lat7;

  const data: VersionInfo = {
    current,
    latest,
    hasUpdate,
    fetchedAt: Date.now(),
    repoUrl:   REPO_URL,
  };
  cache.set(data);
  return NextResponse.json(data);
}
