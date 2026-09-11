import type { NextConfig } from "next";

// Env-driven Prometheus target — same resolution as app/api/metrics/route.ts.
// Keep the default IP in sync with that route. Never hardcode the literal here;
// the dashboard is distributable, so per-deploy infra must be env-overridable.
const TRUENAS_IP = process.env.TRUENAS_IP || "192.168.88.196";
const PROMETHEUS = process.env.PROMETHEUS_URL ?? `http://${TRUENAS_IP}:30104`;
// Needed for the CSP frame-src below — GrafanaCard embeds this origin in an
// iframe. Same default as server-config.ts's grafana.baseUrl.
const GRAFANA = process.env.GRAFANA_BASE_URL ?? `http://${TRUENAS_IP}:30037`;

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

  // Security headers. Previously none were set at all.
  //
  // Honest scope note: `script-src` has to allow 'unsafe-inline' because Next's
  // hydration bootstrap and the pre-hydration theme script in app/layout.tsx are
  // both inline. A nonce-based policy would need per-request header injection in
  // proxy.ts, which is a bigger change than this is worth on a LAN-only single-
  // user deploy. So this CSP is NOT meaningful XSS containment.
  //
  // What it does buy, and the reason it's here:
  //   - `connect-src 'self'` stops any injected script from POSTing somewhere
  //     else. That matters because the /setup wizard leaves every API key in
  //     localStorage under `comexe:setup-wizard` indefinitely.
  //   - `frame-ancestors 'none'` blocks clickjacking the Docker-restart and
  //     config-write controls.
  //   - `img-src` stays permissive on purpose: bookmark icons are user-supplied
  //     favicon URLs from arbitrary domains, plus base64 data: URIs.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: http:",
      "font-src 'self' data:",
      "connect-src 'self'",
      // The Grafana panel is embedded in an iframe by GrafanaCard.
      `frame-src 'self' ${GRAFANA}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
