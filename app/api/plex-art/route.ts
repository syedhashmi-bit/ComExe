import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/app/lib/http";
import { createKeyedTTLCache } from "@/app/lib/cache";
import { loadConfig } from "@/app/lib/server-config";
import { PLEX_ART_PATH } from "@/app/lib/services";

// Poster artwork for the Now playing card, fetched through Tautulli's
// pms_image_proxy so neither the Tautulli API key nor the Plex token ever
// reaches the browser. Only Plex /library/metadata/… paths are accepted and
// only raster images come back: this must never become a general fetcher.

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// An hour per poster, at most 40 kept — a few KB each at card size.
const cache = createKeyedTTLCache<{ body: ArrayBuffer; type: string }>(60 * 60_000, 40);

const size = (raw: string | null, min: number, max: number, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const image = ({ body, type }: { body: ArrayBuffer; type: string }) =>
  new NextResponse(body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const img = params.get("img") ?? "";
  if (!PLEX_ART_PATH.test(img)) return new NextResponse(null, { status: 400 });
  const w = size(params.get("w"), 40, 400, 120);
  const h = size(params.get("h"), 60, 600, 180);

  const key = `${img}@${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return image(hit);

  const cfg = await loadConfig();
  const t = cfg.services.tautulli;
  if (!t.configured) return new NextResponse(null, { status: 404 });

  try {
    const res = await fetchWithTimeout(
      `${t.url}/api/v2?apikey=${encodeURIComponent(t.apiKey ?? "")}&cmd=pms_image_proxy` +
      `&img=${encodeURIComponent(img)}&width=${w}&height=${h}&fallback=poster`,
      { timeoutMs: 8_000 },
    );
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok || !TYPES.has(type)) return new NextResponse(null, { status: 502 });
    const entry = { body: await res.arrayBuffer(), type };
    cache.set(key, entry);
    return image(entry);
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
