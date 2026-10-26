// Prometheus query helpers. The scalar/vector parsing below was copy-pasted
// verbatim across metrics, smart, servers, and custom-cards/query — each route
// re-deriving `json.data.result[0].value[1]` (scalar) and the vector `.map`.
// Centralizing it keeps the brittle response-shape knowledge in one place.
import { fetchJson } from "@/app/lib/http";

interface PromResponse {
  data?: {
    result?: { metric?: Record<string, string>; value?: [number, string] }[];
  };
}

// Single instant-vector scalar (first series' value), or null on any failure.
// Use for one-number queries like `node_load1` or a `sum(...)`.
export async function promScalar(base: string, query: string, timeoutMs?: number): Promise<number | null> {
  const json = await fetchJson<PromResponse>(`${base}/api/v1/query?query=${encodeURIComponent(query)}`, { timeoutMs });
  const v = json?.data?.result?.[0]?.value?.[1];
  return v != null ? parseFloat(v) : null;
}

// Promise.all over a named object instead of an array. The metrics route used
// to destructure ~30 query results positionally out of one Promise.all, where
// inserting a query anywhere but the end silently shifted every later value
// into the wrong field. With names, order carries no meaning.
export async function resolveNamed<T extends Record<string, Promise<unknown>>>(
  promises: T,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys = Object.keys(promises) as (keyof T)[];
  const values = await Promise.all(keys.map((k) => promises[k]));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as { [K in keyof T]: Awaited<T[K]> };
}

export interface PromSample {
  metric: Record<string, string>;
  value: number;
}

// Full instant-vector — every series with its labels. Use for per-device /
// per-mount queries where the caller needs the `metric` labels to group by.
export async function promVector(base: string, query: string, timeoutMs?: number): Promise<PromSample[]> {
  const json = await fetchJson<PromResponse>(`${base}/api/v1/query?query=${encodeURIComponent(query)}`, { timeoutMs });
  return (json?.data?.result ?? []).map((r) => ({
    metric: r.metric ?? {},
    value: parseFloat((r.value ?? [0, "NaN"])[1]),
  }));
}
