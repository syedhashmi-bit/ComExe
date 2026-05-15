// ── Custom card definitions ─────────────────────────────────────────────────
// Stored in data/custom-cards.json. Each card is a user-defined PromQL query
// with a chosen visualization type, color, and label.
//
// IMPORTANT: server-only. Never import from "use client" modules.

import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR    = path.join(process.cwd(), "data");
const CARDS_PATH  = path.join(DATA_DIR, "custom-cards.json");

export interface CustomCardDef {
  id:       string;          // uuid
  label:    string;          // user-visible title
  query:    string;          // PromQL expression
  viz:      "sparkline" | "gauge" | "number" | "bar";
  color:    string;          // hex color
  unit?:    string;          // suffix like "%", "°C", "MB/s"
  position: number;          // sort order (0-based)
}

let cache: { data: CustomCardDef[]; ts: number } | null = null;
const CACHE_TTL = 5_000;

export async function loadCustomCards(): Promise<CustomCardDef[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  try {
    const raw = await fs.readFile(CARDS_PATH, "utf8");
    const cards = JSON.parse(raw) as CustomCardDef[];
    cache = { data: cards, ts: Date.now() };
    return cards;
  } catch {
    cache = { data: [], ts: Date.now() };
    return [];
  }
}

export async function saveCustomCards(cards: CustomCardDef[]): Promise<{ ok: boolean; message: string }> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const sorted = [...cards].sort((a, b) => a.position - b.position);
    await fs.writeFile(CARDS_PATH, JSON.stringify(sorted, null, 2), "utf8");
    cache = null;
    return { ok: true, message: "Saved" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function invalidateCustomCardsCache(): void {
  cache = null;
}
