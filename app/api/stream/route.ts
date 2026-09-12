import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conservative defaults — the *arr stack + PiHole + qBit don't change
// rapidly enough to justify aggressive polling, and the aggregate request
// rate was crashing upstream containers on this user's TrueNAS setup.
// Combined with per-endpoint memoization in the services route, each
// upstream now sees minimal load.
const DEFAULT_INTERVALS: Record<string, number> = {
  metrics:   10000,
  services:  30000,
  mikrotik:  15000,
  activity:  120000,
  speedtest: 600000,
  weather:   600000,
};

// Floor each endpoint's poll interval so user overrides can't accidentally
// flood the homelab. These are the absolute minimums; the defaults above
// are what new installs see.
const MIN_INTERVALS: Record<string, number> = {
  metrics:   5000,
  services:  20000,
  mikrotik:  10000,
  activity:  60000,
  speedtest: 120000,
  weather:   60000,
};

const ENDPOINTS: Record<string, string> = {
  metrics:   "/api/metrics",
  services:  "/api/services",
  mikrotik:  "/api/mikrotik",
  activity:  "/api/activity",
  speedtest: "/api/speedtest",
  weather:   "/api/weather",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const origin = req.nextUrl.origin;

  const intervals: Record<string, number> = {};
  for (const [key, def] of Object.entries(DEFAULT_INTERVALS)) {
    const param = searchParams.get(key);
    const requested = param ? (parseInt(param, 10) || def) : def;
    intervals[key] = Math.max(MIN_INTERVALS[key] ?? 1000, requested);
  }

  const encoder = new TextEncoder();
  const incomingCookie = req.headers.get("cookie");
  let alive = true;
  let streamCleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const timers: ReturnType<typeof setInterval>[] = [];
      let cleanedUp = false;

      function cleanup() {
        if (cleanedUp) return;
        cleanedUp = true;
        alive = false;
        for (const t of timers) clearInterval(t);
        req.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* already closed/cancelled */ }
      }

      function send(event: string, data: unknown) {
        if (!alive) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          alive = false;
        }
      }

      async function fetchAndPush(key: string) {
        if (!alive) return;
        try {
          // Deliberately a bare fetch, not lib/http. This is a SELF-fetch to our
          // own origin, so there is no upstream to protect and no breaker state
          // worth recording — the real upstream calls happen inside the routes
          // being called, which do go through lib/http. Routing this through the
          // breaker would also let one failing internal route open a circuit
          // against the dashboard itself.
          const res = await fetch(`${origin}${ENDPOINTS[key]}`, {
            cache: "no-store",
            // These are self-fetches back through our own HTTP surface, so the
            // auth proxy applies to them too. Without forwarding the caller's
            // cookie every one 401s the moment DASHBOARD_PASSWORD is set — and
            // because the SSE connection itself still succeeds, the client's
            // fallback-to-polling never triggers and the dashboard just sits
            // there permanently empty.
            headers: incomingCookie ? { cookie: incomingCookie } : undefined,
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return;
          const data = await res.json();
          send(key, data);
        } catch { /* upstream down — skip this tick */ }
      }

      send("connected", { ts: Date.now() });

      for (const key of Object.keys(ENDPOINTS)) {
        fetchAndPush(key);
        timers.push(setInterval(() => fetchAndPush(key), intervals[key]));
      }

      const heartbeat = setInterval(() => {
        send("heartbeat", { ts: Date.now() });
      }, 30000);
      timers.push(heartbeat);

      // Two independent cleanup paths, because either can fire first: the
      // request's abort signal on disconnect, and the stream's own cancel().
      // Both funnel into the same idempotent cleanup() so the per-endpoint
      // intervals can't be left running (they used to pile up across
      // reconnects and keep hammering upstream services).
      if (req.signal.aborted) { cleanup(); return; }
      req.signal.addEventListener("abort", cleanup);
      streamCleanup = cleanup;
    },
    // NOTE: the Streams API passes the cancellation REASON here, not the
    // controller. This previously read `cancel(controller)` and reached for a
    // `_cleanup` property stashed on it, which was always undefined — so this
    // path silently did nothing and only the abort listener above ever ran.
    cancel() {
      streamCleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
