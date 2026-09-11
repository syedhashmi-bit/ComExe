"use client";

import { useEffect, useRef } from "react";

// ── Visibility-aware polling ────────────────────────────────────────────────
// Replaces the `useEffect(() => { fn(); const id = setInterval(fn, ms); return
// () => clearInterval(id); }, [...])` block that was copy-pasted across
// page.tsx (5 copies) and eight components.
//
// The behaviour change that matters: **nothing polls while the tab is hidden.**
// Before this, the only `document.visibilityState` reference in the codebase
// gated a browser *notification*, never a request. A laptop left open on the
// dashboard overnight kept every upstream poller running — including
// GrafanaCard's 60s headless PNG render, the single heaviest upstream call in
// the app, and the 3s pollers in the logs views. That is the same shape as the
// original incident where 3s polling SIGKILL'd the *arr stack (see the comment
// at the top of lib/circuit-breaker.ts); it just took longer to get there.
//
// On becoming visible again we fire once immediately, so returning to the tab
// shows fresh data rather than whatever was on screen when you left.

export interface PollingOptions {
  // When false, no fetch and no interval — used for demo mode and for the
  // SSE-vs-polling switch in page.tsx.
  enabled?: boolean;
  // Skip the immediate call on mount; only run on the interval.
  skipImmediate?: boolean;
}

export function usePollingInterval(
  fn: () => void,
  intervalMs: number,
  { enabled = true, skipImmediate = false }: PollingOptions = {},
): void {
  // Keep the latest callback without making it a dependency — otherwise an
  // inline arrow would tear down and re-create the interval on every render,
  // which is the reconnect-storm shape page.tsx:354 warns about.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const run = () => fnRef.current();

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        run();    // catch up immediately — the tab may have been hidden for hours
        start();
      }
    };

    if (!document.hidden) {
      if (!skipImmediate) run();
      start();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs, skipImmediate]);
}
