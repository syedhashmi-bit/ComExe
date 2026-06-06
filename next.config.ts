import type { NextConfig } from "next";

// Env-driven Prometheus target — same resolution as app/api/metrics/route.ts.
// Keep the default IP in sync with that route. Never hardcode the literal here;
// the dashboard is distributable, so per-deploy infra must be env-overridable.
const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";
const PROMETHEUS = process.env.PROMETHEUS_URL ?? `http://${TRUENAS_IP}:30104`;

const nextConfig: NextConfig = {
  // Standalone mode was previously enabled but removed because the
  // post-build NFT trace step (which produces the standalone artifact)
  // crashed with SIGSEGV on TrueNAS. The runner stage now uses
  // `next start` against the regular .next output instead.
  experimental: {
    webpackMemoryOptimizations: true,
  },
  // Manual debug proxy: GET /prometheus/* forwards to the Prometheus instance.
  // Resolved at server start from env, so the published image works for any deploy.
  async rewrites() {
    return [
      {
        source: "/prometheus/:path*",
        destination: `${PROMETHEUS}/:path*`,
      },
    ];
  },
};

export default nextConfig;
