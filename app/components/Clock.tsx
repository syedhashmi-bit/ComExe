"use client";

import { useEffect, useState } from "react";

// Header clock, extracted from the Dashboard component. It ticks once a second;
// keeping its state local means only this ~3-element subtree re-renders each
// second instead of the entire 2000-line Dashboard (which also drives the SSE
// connection memo — see the note on `sseIntervals` in page.tsx). Returns null
// until the first tick to avoid an SSR/hydration mismatch on the time string.

export function Clock({ timezone }: { timezone?: string }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  useEffect(() => {
    function tick() {
      const now = new Date();
      const tz = timezone || undefined;
      const opts: Intl.DateTimeFormatOptions = tz ? { timeZone: tz } : {};
      const days   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const parts  = new Intl.DateTimeFormat("en-US", { ...opts, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
      const get    = (t: string) => parts.find(p => p.type === t)?.value ?? "";
      if (tz) {
        setDate(`${get("weekday")} · ${get("day")} ${get("month")}`);
        setTime(`${get("hour")}:${get("minute")}:${get("second")}`);
      } else {
        const h = String(now.getHours()).padStart(2, "0");
        const m = String(now.getMinutes()).padStart(2, "0");
        const s = String(now.getSeconds()).padStart(2, "0");
        setDate(`${days[now.getDay()]} · ${now.getDate()} ${months[now.getMonth()]}`);
        setTime(`${h}:${m}:${s}`);
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timezone]);

  if (!date) return null;

  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="hidden sm:block" style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "inherit" }}>{date}</span>
      <span className="font-mono tabular-nums" style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{time}</span>
    </div>
  );
}
