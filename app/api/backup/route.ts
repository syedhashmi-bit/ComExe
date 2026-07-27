import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, DATA_BOOKMARKS, invalidateBookmarksCache } from "@/app/lib/bookmarks";

export const dynamic = "force-dynamic";

// DATA_DIR comes from the shared module. This route used to honour a
// `process.env.DATA_DIR` override that no other module read — set it and the
// backup would quietly read and write a different directory than the one
// everything else persists to.

const BACKUP_FILES = [
  "config.json",
  "custom-cards.json",
  "alerts.json",
  // Both are real user data written by their own routes and were simply
  // missing here, so fleet entries and the dependency graph were silently
  // absent from every export.
  "servers.json",
  "dependencies.json",
];

export async function GET() {
  const bundle: Record<string, unknown> = {
    _meta: {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: "comexe",
    },
  };

  for (const file of BACKUP_FILES) {
    try {
      const content = await fs.readFile(path.join(DATA_DIR, file), "utf-8");
      bundle[file.replace(".json", "")] = JSON.parse(content);
    } catch {
      // file doesn't exist or isn't valid json — skip
    }
  }

  // Export whatever loadBookmarks() would actually serve. Reading
  // BOOKMARKS_PATH / cwd directly skipped data/bookmarks.json — the file the
  // UI writes and the one loadBookmarks() prefers — so any bookmark edited in
  // the app was missing from the backup, which exported the stale mounted copy.
  try {
    const { loadBookmarks } = await import("@/app/lib/bookmarks");
    bundle.bookmarks = await loadBookmarks();
  } catch {
    // no bookmarks available
  }

  try {
    const settingsKey = "comexe:settings";
    bundle._meta_note = `Client settings stored in localStorage key "${settingsKey}" — not included in server backup. Export from browser Settings panel.`;
  } catch { /* ignore */ }

  return NextResponse.json(bundle, {
    headers: {
      "Content-Disposition": `attachment; filename="comexe-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || body._meta?.app !== "comexe") {
      return NextResponse.json({ ok: false, message: "Invalid backup file — missing ComExe metadata" }, { status: 400 });
    }

    try {
      await fs.access(DATA_DIR);
    } catch {
      await fs.mkdir(DATA_DIR, { recursive: true });
    }

    const restored: string[] = [];

    for (const file of BACKUP_FILES) {
      const key = file.replace(".json", "");
      if (body[key] && typeof body[key] === "object") {
        await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(body[key], null, 2), "utf-8");
        restored.push(file);
      }
    }

    // Restore into data/bookmarks.json — the writable location loadBookmarks()
    // reads first. The old code wrote to the BOOKMARKS_PATH mount, which is
    // mounted `:ro` in the documented docker run (so the write failed), and
    // even on success would have been shadowed by data/bookmarks.json.
    if (body.bookmarks && Array.isArray(body.bookmarks)) {
      await fs.writeFile(DATA_BOOKMARKS, JSON.stringify(body.bookmarks, null, 2), "utf-8");
      invalidateBookmarksCache();
      restored.push("bookmarks.json");
    }

    return NextResponse.json({ ok: true, restored, message: `Restored ${restored.length} file(s): ${restored.join(", ")}` });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Import failed: ${(e as Error).message}` }, { status: 500 });
  }
}
