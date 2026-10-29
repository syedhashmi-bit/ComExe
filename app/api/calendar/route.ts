import { NextResponse } from "next/server";
import { getCalendar } from "@/app/lib/calendar";

// Sonarr + Radarr calendars for the "Coming up" card: the last 7 days and the
// next 7. Cached 15 minutes in lib/calendar.ts; the card polls on the same
// cadence. Read-only.
export async function GET() {
  try {
    return NextResponse.json(await getCalendar());
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error)?.message ?? "unknown error" }, { status: 500 });
  }
}
