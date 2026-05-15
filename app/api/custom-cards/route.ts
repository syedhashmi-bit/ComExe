import { NextResponse } from "next/server";
import { loadCustomCards, saveCustomCards, type CustomCardDef } from "@/app/lib/custom-cards";

// ── GET /api/custom-cards ───────────────────────────────────────────────────
export async function GET() {
  const cards = await loadCustomCards();
  return NextResponse.json({ cards });
}

// ── POST /api/custom-cards ──────────────────────────────────────────────────
// Body: full array of CustomCardDef[]. The client sends the complete list
// (add/edit/remove happen client-side, then save the whole set).
export async function POST(req: Request) {
  let body: { cards?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON" }, { status: 400 }); }

  if (!Array.isArray(body.cards)) {
    return NextResponse.json({ ok: false, message: "cards must be an array" }, { status: 400 });
  }

  const validViz = ["sparkline", "gauge", "number", "bar"];
  for (let i = 0; i < body.cards.length; i++) {
    const c = body.cards[i] as Record<string, unknown>;
    if (typeof c.id !== "string" || !c.id)       return NextResponse.json({ ok: false, message: `cards[${i}].id required` }, { status: 400 });
    if (typeof c.label !== "string" || !c.label)  return NextResponse.json({ ok: false, message: `cards[${i}].label required` }, { status: 400 });
    if (typeof c.query !== "string" || !c.query)  return NextResponse.json({ ok: false, message: `cards[${i}].query required` }, { status: 400 });
    if (!validViz.includes(c.viz as string))       return NextResponse.json({ ok: false, message: `cards[${i}].viz must be one of ${validViz.join(", ")}` }, { status: 400 });
    if (typeof c.color !== "string")              return NextResponse.json({ ok: false, message: `cards[${i}].color required` }, { status: 400 });
  }

  const result = await saveCustomCards(body.cards as CustomCardDef[]);
  if (!result.ok) return NextResponse.json(result, { status: 500 });
  return NextResponse.json({ ok: true });
}
