// Process-wide singletons that survive separate module instances.
//
// Next compiles instrumentation.ts (which starts the background collector) as a
// separate entry from the route handlers, so a plain module-level `let cache`
// can exist twice in one process: once as seen by the collector and once as
// seen by /api/metrics. Two copies of a cache means two sets of upstream calls
// — the exact load problem the caches exist to prevent — and an event emitted
// by the collector would never reach /api/stream's listeners.
//
// Anything shared between the collector and a route goes through here. The
// Symbol.for key is registry-global, so every module instance resolves the
// same slot. It also survives `next dev` HMR re-evaluation, which is what stops
// a hot reload from starting a second collector loop.
//
// IMPORTANT: server-only. Never import from "use client" modules.

export function globalSingleton<T>(key: string, factory: () => T): T {
  const g = globalThis as unknown as Record<symbol, unknown>;
  const sym = Symbol.for(`comexe.${key}`);
  if (!(sym in g)) g[sym] = factory();
  return g[sym] as T;
}
