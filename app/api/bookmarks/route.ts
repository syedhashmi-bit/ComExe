import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import {
  loadBookmarks,
  invalidateBookmarksCache,
  DATA_DIR,
  DATA_BOOKMARKS,
} from "@/app/lib/bookmarks";

// ── /api/bookmarks ──────────────────────────────────────────────────────────
// GET  → load current bookmarks (shared loader; same priority everywhere)
// POST → save bookmarks to data/bookmarks.json (the writable mount). Invalidates
//        the shared cache so /api/config's next GET also sees the new data.

export async function GET() {
  const bookmarks = await loadBookmarks();
  return NextResponse.json({ bookmarks });
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 }); }

  if (!body || typeof body !== "object" || !Array.isArray((body as { bookmarks?: unknown }).bookmarks)) {
    return NextResponse.json({ ok: false, message: "Body must have a `bookmarks` array" }, { status: 400 });
  }

  const bookmarks = (body as { bookmarks: unknown[] }).bookmarks;

  // Basic shape validation
  for (let i = 0; i < bookmarks.length; i++) {
    const col = bookmarks[i] as Record<string, unknown>;
    if (typeof col.title !== "string") return NextResponse.json({ ok: false, message: `bookmarks[${i}].title must be a string` }, { status: 400 });
    if (typeof col.accentColor !== "string") return NextResponse.json({ ok: false, message: `bookmarks[${i}].accentColor must be a string` }, { status: 400 });
    if (!Array.isArray(col.items)) return NextResponse.json({ ok: false, message: `bookmarks[${i}].items must be an array` }, { status: 400 });
    for (let j = 0; j < (col.items as unknown[]).length; j++) {
      const item = (col.items as Record<string, unknown>[])[j];
      if (typeof item.name !== "string") return NextResponse.json({ ok: false, message: `bookmarks[${i}].items[${j}].name must be a string` }, { status: 400 });
      if (typeof item.url !== "string") return NextResponse.json({ ok: false, message: `bookmarks[${i}].items[${j}].url must be a string` }, { status: 400 });
      if (typeof item.icon !== "string") return NextResponse.json({ ok: false, message: `bookmarks[${i}].items[${j}].icon must be a string` }, { status: 400 });
      // Cap base64 icons at ~15kb to keep config reasonable
      if (item.icon.startsWith("data:") && (item.icon as string).length > 20_000) {
        return NextResponse.json({ ok: false, message: `bookmarks[${i}].items[${j}].icon is too large (max ~10kb base64)` }, { status: 400 });
      }
    }
  }

  // Write to data/bookmarks.json
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = DATA_BOOKMARKS + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(bookmarks, null, 2), "utf8");
    await fs.rename(tmp, DATA_BOOKMARKS);
    invalidateBookmarksCache();
    return NextResponse.json({ ok: true, message: `Saved ${bookmarks.length} columns to ${DATA_BOOKMARKS}` });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Write failed: ${(e as Error).message}. Mount a writable volume at /app/data.` }, { status: 500 });
  }
}
