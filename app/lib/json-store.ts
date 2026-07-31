// ── Shared JSON file store ───────────────────────────────────────────────────
// Every file under data/ was previously loaded and saved by hand in its own
// route: readFile → JSON.parse → try/catch, then mkdir → writeFile. Six
// near-copies with subtly different path logic and error handling, which is
// exactly how the backup route ended up reading a different bookmarks file
// than the one the UI writes.
//
// Writes go through a temp file + rename so a crash mid-write can't leave a
// truncated JSON file behind (the alerts route was the only one doing this).
//
// IMPORTANT: server-only. Never import from "use client" modules.

import { promises as fs } from "node:fs";
import path from "node:path";

// Single definition of where persisted state lives. Everything that writes to
// data/ should resolve its path from here.
export const DATA_DIR = path.join(process.cwd(), "data");

export function dataPath(filename: string): string {
  return path.join(DATA_DIR, filename);
}

export interface JsonStore<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
  // Best-effort write that reports failure instead of throwing — for the
  // "read-only install" case where data/ isn't a writable mount.
  tryWrite(value: T): Promise<{ ok: boolean; message?: string }>;
  path: string;
}

// `fallback` is returned whenever the file is missing, unreadable, or contains
// invalid JSON — persisted state is always best-effort here, matching the
// project's "degrade, never crash" rule.
export function createJsonStore<T>(filename: string, fallback: () => T): JsonStore<T> {
  const filePath = dataPath(filename);

  return {
    path: filePath,

    async read(): Promise<T> {
      try {
        return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
      } catch {
        return fallback();
      }
    },

    async write(value: T): Promise<void> {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
      await fs.rename(tmp, filePath);
    },

    async tryWrite(value: T): Promise<{ ok: boolean; message?: string }> {
      try {
        await this.write(value);
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          message: `Could not write ${filePath}: ${(e as Error)?.message ?? "unknown error"}. ` +
                   `Mount a writable volume at ${DATA_DIR} to enable saves.`,
        };
      }
    },
  };
}
