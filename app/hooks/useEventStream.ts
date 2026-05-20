"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SSEHandler = (event: string, data: unknown) => void;

interface UseEventStreamOptions {
  enabled: boolean;
  intervals?: Record<string, number>;
  onMessage: SSEHandler;
}

export function useEventStream({ enabled, intervals, onMessage }: UseEventStreamOptions) {
  const [connected, setConnected] = useState(false);
  const [fallback, setFallback] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Stable identity for intervals — derive a string signature so we only
  // tear down the EventSource when values actually change, not when the
  // caller passes a fresh object literal on every render.
  const intervalsKey = useMemo(
    () => intervals ? JSON.stringify(intervals) : "",
    [intervals],
  );

  useEffect(() => {
    if (!enabled) {
      setFallback(true);
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;

      const params = new URLSearchParams();
      if (intervalsKey) {
        const parsed = JSON.parse(intervalsKey) as Record<string, number>;
        for (const [k, v] of Object.entries(parsed)) {
          params.set(k, String(v));
        }
      }

      const url = `/api/stream${params.toString() ? `?${params}` : ""}`;
      const es = new EventSource(url);
      esRef.current = es;

      const EVENTS = ["connected", "metrics", "services", "mikrotik", "activity", "speedtest", "weather", "heartbeat"];

      for (const evt of EVENTS) {
        es.addEventListener(evt, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (evt === "connected" || evt === "heartbeat") {
              setConnected(true);
              retriesRef.current = 0;
              return;
            }
            onMessageRef.current(evt, data);
          } catch { /* malformed data — skip */ }
        });
      }

      es.onerror = () => {
        setConnected(false);
        es.close();
        esRef.current = null;
        retriesRef.current++;
        if (retriesRef.current >= 3) {
          setFallback(true);
          return;
        }
        // Conservative backoff so a flaky upstream doesn't trigger a
        // reconnect storm. Each reconnect re-fetches all 6 SSE endpoints
        // server-side, so we want long gaps between attempts.
        const delay = Math.min(60_000, 10_000 * Math.pow(2, retriesRef.current - 1));
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [enabled, intervalsKey]);

  return { connected, fallback };
}
