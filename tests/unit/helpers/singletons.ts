// lib/singleton.ts parks shared state on globalThis under Symbol.for keys so it
// survives separate module instances. That also means vi.resetModules() does
// NOT reset it — call this in beforeEach for any test touching that state.
export function resetGlobalSingletons(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  for (const sym of Object.getOwnPropertySymbols(g)) {
    if (Symbol.keyFor(sym)?.startsWith("comexe.")) delete g[sym];
  }
}
