// ── Per-origin circuit breaker ───────────────────────────────────────────────
// The dashboard has crashed upstream containers before: the original 3s polling
// fired ~20 API calls/sec and SIGKILL'd the *arr stack / PiHole. The fix at the
// time was static throttling (fixed intervals, batching, memoization), which
// lowers the steady-state rate but does nothing when a service is *already*
// struggling — a dead upstream still gets polled at full rate forever.
//
// This adds real backpressure. After N consecutive failures to an origin the
// circuit OPENS: calls fail immediately without touching the network for a
// cooldown window. One probe is then allowed through (HALF-OPEN); success
// closes the circuit, failure re-opens it with a longer backoff.
//
// Callers don't need to change: an open circuit throws, and every upstream call
// already funnels through fetchWithTimeout/fetchJson, which degrade to null and
// render "—". The difference is we stop generating the traffic.
//
// The recorded stats double as the data source for /api/diagnostics — the
// dashboard previously had no way to explain *why* a card was empty.

export type CircuitState = "closed" | "open" | "half-open";

export interface OriginHealth {
  origin:              string;
  state:               CircuitState;
  consecutiveFailures: number;
  totalCalls:          number;
  totalFailures:       number;
  lastSuccessTs:       number | null;
  lastFailureTs:       number | null;
  lastError:           string | null;
  // When open, when the next probe is allowed.
  retryAtTs:           number | null;
}

const FAILURE_THRESHOLD = 5;       // consecutive failures before opening
const BASE_COOLDOWN_MS  = 30_000;  // first open lasts 30s
const MAX_COOLDOWN_MS   = 300_000; // capped at 5 min

interface Entry extends OriginHealth {
  openCount: number; // consecutive opens, drives exponential backoff
}

const origins = new Map<string, Entry>();

export class CircuitOpenError extends Error {
  constructor(origin: string, retryAtTs: number) {
    const secs = Math.max(0, Math.ceil((retryAtTs - Date.now()) / 1000));
    super(`Circuit open for ${origin} — not retrying for ~${secs}s`);
    this.name = "CircuitOpenError";
  }
}

// Bare origin (scheme://host:port) — the breaker is per-service, not per-path.
export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function entryFor(origin: string): Entry {
  let e = origins.get(origin);
  if (!e) {
    e = {
      origin, state: "closed", consecutiveFailures: 0,
      totalCalls: 0, totalFailures: 0,
      lastSuccessTs: null, lastFailureTs: null, lastError: null,
      retryAtTs: null, openCount: 0,
    };
    origins.set(origin, e);
  }
  return e;
}

// Returns null when the call may proceed, or the reason it may not.
export function checkCircuit(origin: string): CircuitOpenError | null {
  const e = entryFor(origin);
  if (e.state !== "open") return null;

  if (e.retryAtTs != null && Date.now() >= e.retryAtTs) {
    // Cooldown elapsed — let exactly one probe through.
    e.state = "half-open";
    return null;
  }
  return new CircuitOpenError(origin, e.retryAtTs ?? Date.now());
}

export function recordSuccess(origin: string): void {
  const e = entryFor(origin);
  e.totalCalls++;
  e.consecutiveFailures = 0;
  e.openCount = 0;
  e.state = "closed";
  e.retryAtTs = null;
  e.lastSuccessTs = Date.now();
  e.lastError = null;
}

export function recordFailure(origin: string, error?: unknown): void {
  const e = entryFor(origin);
  e.totalCalls++;
  e.totalFailures++;
  e.consecutiveFailures++;
  e.lastFailureTs = Date.now();
  e.lastError = error instanceof Error ? error.message : error != null ? String(error) : null;

  // A failed half-open probe re-opens immediately with a longer cooldown.
  if (e.state === "half-open" || e.consecutiveFailures >= FAILURE_THRESHOLD) {
    e.state = "open";
    e.openCount++;
    const cooldown = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** (e.openCount - 1));
    e.retryAtTs = Date.now() + cooldown;
  }
}

export function snapshot(): OriginHealth[] {
  return [...origins.values()]
    .map(({ openCount: _openCount, ...health }) => health)
    .sort((a, b) => a.origin.localeCompare(b.origin));
}

// Test seam.
export function resetCircuits(): void {
  origins.clear();
}
