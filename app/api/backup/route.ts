import { NextRequest, NextResponse } from "next/server";
import { isJsonContentType } from "@/app/lib/validate";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_BOOKMARKS, invalidateBookmarksCache } from "@/app/lib/bookmarks";
import { DATA_DIR, createJsonStore } from "@/app/lib/json-store";
import { writeConfigFile, invalidateConfigCache, type PartialFileConfig } from "@/app/lib/server-config";

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

// config.json / alerts.json are objects; servers.json / custom-cards.json /
// dependencies.json are arrays. Enforcing the container type is cheap and
// catches a hand-edited or mismatched-version bundle before it lands on disk.
const ARRAY_FILES = new Set(["servers.json", "custom-cards.json", "dependencies.json"]);

function matchesExpectedShape(file: string, value: unknown): boolean {
  return ARRAY_FILES.has(file) ? Array.isArray(value) : !Array.isArray(value) && typeof value === "object";
}

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
  if (!isJsonContentType(req)) {
    return NextResponse.json({ ok: false, message: "Content-Type must be application/json" }, { status: 415 });
  }
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
      const value = body[key];
      if (value == null || typeof value !== "object") continue;

      // Shape-check before writing. These files are read back by loadConfig(),
      // loadCustomCards() etc. on the next request, and a wrong container type
      // (array where an object is expected, or vice versa) puts them into a
      // permanently-broken state that only a manual file edit clears.
      if (!matchesExpectedShape(file, value)) {
        return NextResponse.json(
          { ok: false, message: `Invalid backup: "${key}" has the wrong shape for ${file}` },
          { status: 400 },
        );
      }

      if (file === "config.json") {
        // Route through writeConfigFile rather than a raw write: it writes via
        // temp-file + rename AND sets mode 0600. A plain writeFile here left
        // the credential store world-readable after every restore.
        const res = await writeConfigFile(value as PartialFileConfig);
        if (!res.ok) {
          return NextResponse.json({ ok: false, message: res.message }, { status: 500 });
        }
        invalidateConfigCache();
      } else {
        // createJsonStore writes atomically (temp + rename). The previous plain
        // writeFile meant an interrupted restore left truncated JSON behind —
        // this was the only non-atomic writer left in the codebase.
        await createJsonStore<unknown>(file, () => null).write(value);
      }
      restored.push(file);
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
