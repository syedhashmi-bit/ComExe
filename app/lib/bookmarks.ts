// ── Shared bookmark loader ───────────────────────────────────────────────────
// Single source of truth for resolving where to read bookmarks from. Used by
// both /api/bookmarks (CRUD) and /api/config (initial page load), so an edit
// saved via POST is visible to the next GET on either route.
//
// Priority (highest first):
//   1. data/bookmarks.json  — written by POST /api/bookmarks (the wizard path)
//   2. $BOOKMARKS_PATH       — explicit override, mounted file
//   3. cwd/bookmarks.json    — baked-in fallback (e.g. /app/bookmarks.json in image)
//   4. DEFAULT_BOOKMARKS     — hardcoded fallback if nothing else resolves

import { promises as fs } from "node:fs";
import path from "node:path";
import type { BookmarkColumn } from "@/app/lib/types";

export const DATA_DIR = path.join(process.cwd(), "data");
export const DATA_BOOKMARKS = path.join(DATA_DIR, "bookmarks.json");

export const DEFAULT_BOOKMARKS: BookmarkColumn[] = [
  {
    title: "Social",
    accentColor: "#06b6d4",
    items: [
      { name: "YouTube", url: "https://www.youtube.com", icon: "https://www.google.com/s2/favicons?domain=youtube.com&sz=32" },
      { name: "Reddit",  url: "https://www.reddit.com",  icon: "https://www.google.com/s2/favicons?domain=reddit.com&sz=32"  },
    ],
  },
  {
    title: "Productivity",
    accentColor: "#10b981",
    items: [
      { name: "ChatGPT", url: "https://chat.openai.com", icon: "https://www.google.com/s2/favicons?domain=openai.com&sz=32" },
      { name: "Gmail",   url: "https://mail.google.com", icon: "https://www.google.com/s2/favicons?domain=gmail.com&sz=32"  },
    ],
  },
];

let cache: { data: BookmarkColumn[]; ts: number } | null = null;
const CACHE_TTL = 10_000;

export async function loadBookmarks(): Promise<BookmarkColumn[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  const paths = [
    DATA_BOOKMARKS,
    process.env.BOOKMARKS_PATH,
    path.join(process.cwd(), "bookmarks.json"),
  ].filter(Boolean) as string[];

  for (const p of paths) {
    try {
      const raw = await fs.readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cache = { data: parsed as BookmarkColumn[], ts: Date.now() };
        return parsed as BookmarkColumn[];
      }
    } catch { /* try next */ }
  }

  cache = { data: DEFAULT_BOOKMARKS, ts: Date.now() };
  return DEFAULT_BOOKMARKS;
}

export function invalidateBookmarksCache(): void {
  cache = null;
}
