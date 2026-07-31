import { describe, it, expect, beforeEach, vi } from "vitest";

const files = new Map<string, string>();
let failWrites = false;

vi.mock("node:fs", () => ({
  promises: {
    mkdir:     vi.fn(async () => undefined),
    readFile:  vi.fn(async (p: string) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    }),
    writeFile: vi.fn(async (p: string, d: string) => {
      if (failWrites) throw Object.assign(new Error("EROFS: read-only file system"), { code: "EROFS" });
      files.set(p, d);
    }),
    rename:    vi.fn(async (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
  },
}));

describe("json store", () => {
  beforeEach(() => {
    files.clear();
    failWrites = false;
    vi.resetModules();
  });

  it("returns the fallback when the file is missing", async () => {
    const { createJsonStore } = await import("@/app/lib/json-store");
    const store = createJsonStore<string[]>("missing.json", () => ["default"]);
    expect(await store.read()).toEqual(["default"]);
  });

  it("returns the fallback on malformed JSON rather than throwing", async () => {
    const { createJsonStore } = await import("@/app/lib/json-store");
    const store = createJsonStore<string[]>("broken.json", () => ["default"]);
    files.set(store.path, "{ not json");
    expect(await store.read()).toEqual(["default"]);
  });

  it("round-trips a value", async () => {
    const { createJsonStore } = await import("@/app/lib/json-store");
    const store = createJsonStore<{ a: number }>("thing.json", () => ({ a: 0 }));
    await store.write({ a: 42 });
    expect(await store.read()).toEqual({ a: 42 });
  });

  it("writes atomically via a temp file + rename", async () => {
    const { createJsonStore } = await import("@/app/lib/json-store");
    const { promises: fs } = await import("node:fs");
    const store = createJsonStore<number[]>("atomic.json", () => []);
    await store.write([1, 2, 3]);

    // A crash mid-write must not be able to truncate the real file.
    expect(fs.writeFile).toHaveBeenCalledWith(`${store.path}.tmp`, expect.any(String), "utf8");
    expect(fs.rename).toHaveBeenCalledWith(`${store.path}.tmp`, store.path);
    expect(files.has(`${store.path}.tmp`)).toBe(false);
  });

  it("tryWrite reports read-only installs instead of throwing", async () => {
    const { createJsonStore } = await import("@/app/lib/json-store");
    const store = createJsonStore<number[]>("ro.json", () => []);
    failWrites = true;

    const res = await store.tryWrite([1]);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/read-only file system/i);
    expect(res.message).toMatch(/Mount a writable volume/);
  });

  it("resolves every file under a single data dir", async () => {
    const { createJsonStore, DATA_DIR, dataPath } = await import("@/app/lib/json-store");
    const store = createJsonStore("x.json", () => null);
    expect(store.path).toBe(dataPath("x.json"));
    expect(store.path.startsWith(DATA_DIR)).toBe(true);
  });
});
