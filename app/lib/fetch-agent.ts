// Process-wide undici dispatcher with strict per-origin connection limits.
//
// Why this exists:
//   Node.js `fetch` (powered by undici) maintains a keep-alive socket pool per
//   origin (default ~10 concurrent sockets/host). With our cluster of routes
//   all hammering 192.168.88.196:30025 (radarr), :33027 (sonarr), etc., a
//   regression anywhere in the codebase could open dozens of concurrent
//   sockets to the same *arr container. .NET kestrel + sqlite-backed apps
//   tend to fall over under that.
//
// Cap each origin at 2 concurrent sockets. Even if the dashboard goes haywire
// and tries to open 20 connections at once, undici will queue them and never
// have more than 2 in flight per upstream. Defense-in-depth — the real fix
// is the SSE reconnect storm in useEventStream, but this prevents future
// regressions from being able to crash the *arrs.
//
// Imported at the top of any route that makes outbound HTTP calls. The
// dispatcher is global; importing once anywhere applies process-wide.

import { Agent, setGlobalDispatcher } from "undici";

let installed = false;

export function installFetchAgent(): void {
  if (installed) return;
  installed = true;
  setGlobalDispatcher(new Agent({
    connections: 2,            // max concurrent sockets per origin
    pipelining: 1,             // sequential, no HTTP pipelining
    keepAliveTimeout: 10_000,  // 10s idle then close — prevents stale conns
    keepAliveMaxTimeout: 60_000,
  }));
}

// Auto-install on import.
installFetchAgent();
