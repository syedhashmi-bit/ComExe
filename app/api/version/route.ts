import { NextResponse } from "next/server";
import { fetchJson } from "@/app/lib/http";
import { createTTLCache } from "@/app/lib/cache";

// ── /api/version ─────────────────────────────────────────────────────────────
// Reports the running image's git SHA (baked at Docker build time via
// COMEXE_GIT_SHA build-arg) and compares to the latest commit on
// syedhashmi-bit/ComExe@main via the GitHub REST API. The frontend uses
// `hasUpdate` to render a small "update available" banner.
//
// Docs-only awareness: build.yml carries `paths-ignore: ["**.md"]`, so a commit
// that touches only Markdown never republishes the image — `:latest` keeps the
// previous SHA. Comparing the baked SHA against bare main HEAD therefore shows a
// phantom "update available" that pulling can never clear (the new SHA has no
// image). To match CI, when the SHAs differ we diff the range via the compare
// API and only flag an update if a non-`.md` file changed (i.e. CI would have
// actually built a new image).
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
const GH_HEADERS = { Accept: "application/vnd.github+json" };

// Mirrors build.yml's `paths-ignore: ["**.md"]`: true only when the diff between
// `base` and `head` includes at least one non-Markdown file (so CI would have
// rebuilt the image). On any API failure, fall back to `true` so a real update
// is never hidden — a flaky compare call shows a maybe-stale banner, which is
// the harmless direction. The `files` array is GitHub-capped at 300 entries;
// any real code change lands a non-`.md` file well inside that.
async function diffHasBuildableChange(base: string, head: string): Promise<boolean> {
  const cmp = await fetchJson<{ files?: { filename?: string }[] }>(
    `https://api.github.com/repos/syedhashmi-bit/ComExe/compare/${base}...${head}`,
    { timeoutMs: 4000, headers: GH_HEADERS },
  );
  if (!cmp?.files) return true;
  return cmp.files.some(f => typeof f.filename === "string" && !f.filename.endsWith(".md"));
}

export async function GET() {
  const current = process.env.COMEXE_GIT_SHA?.trim() || "dev";

  const cached = cache.get();
  if (cached) return NextResponse.json(cached);

  // Swallowed on failure — the banner just won't show.
  const body = await fetchJson<{ sha?: string }>(REPO_API, {
    timeoutMs: 4000,
    headers: GH_HEADERS,
  });
  const latest: string | null = typeof body?.sha === "string" ? body.sha : null;

  // Compare on first 7 chars — the short SHA. Same convention as `git log
  // --oneline` and what the banner displays.
  const cur7 = current.slice(0, 7);
  const lat7 = latest ? latest.slice(0, 7) : null;
  const shaDiffers = current !== "dev" && lat7 != null && cur7 !== lat7;
  // Only surface the banner when CI would actually republish the image for the
  // delta — a docs-only diff produces no new image, so pulling can't clear it.
  const hasUpdate = shaDiffers && await diffHasBuildableChange(current, latest!);

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
