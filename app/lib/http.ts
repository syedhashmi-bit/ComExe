// Shared outbound-HTTP helpers. Eliminates the ~40 per-route reimplementations
// of `fetch` + abort-timeout + try/catch that drifted apart (timeouts of
// 4s/5s/8s/10s, two different abort styles). Importing this also installs the
// global undici dispatcher (per-origin socket cap) via the side-effect import.
import "@/app/lib/fetch-agent";

// Default per-request timeout. Homelab upstreams (*arr, Prometheus, RouterOS)
// answer well under this; override per call with `timeoutMs`.
export const DEFAULT_TIMEOUT_MS = 5_000;

export interface FetchOpts extends RequestInit {
  timeoutMs?: number;
}

// fetch + abort-timeout, returning the raw Response. Use when the caller needs
// the status code or headers (e.g. distinguishing 401/403/404). Throws on
// network error or timeout — the caller decides how to degrade. A caller-
// supplied `signal` takes precedence over the built-in timeout.
export async function fetchWithTimeout(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = opts;
  return fetch(url, {
    cache: "no-store",
    ...init,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });
}

// fetch → parsed JSON, or null on any failure (non-2xx, timeout, network,
// invalid JSON). Matches the "render — on failure, never throw" convention used
// throughout the API routes. Use for the common "give me the body or nothing".
export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(url, opts);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
