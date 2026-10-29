import { NextResponse } from "next/server";
import { getStorageInsight } from "@/app/lib/storage";

// Fill-up forecast, pool state and ZFS cache stats for the Filesystems card.
// Cached for 10 minutes in lib/storage.ts; the card polls it on the same slow
// cadence, never from the 10s metrics stream.
export async function GET() {
  try {
    return NextResponse.json(await getStorageInsight());
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error)?.message ?? "unknown error" }, { status: 500 });
  }
}
