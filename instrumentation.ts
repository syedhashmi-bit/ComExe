// Next.js calls register() once per server process, before it accepts
// requests. The collector is started without awaiting it: register() blocks
// readiness, and the collector's first tick can take seconds when upstreams
// are slow.
//
// Disable with COMEXE_COLLECTOR=0 (the e2e suite does, so CI never polls the
// default homelab IP).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startCollector } = await import("./app/lib/collector");
  startCollector();
}
