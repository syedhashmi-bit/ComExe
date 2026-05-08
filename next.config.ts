import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Reduces peak memory during the build phase. Was needed because the
  // production Docker build on TrueNAS was crashing with SIGSEGV — the
  // Next.js build worker was getting OOM-killed by Docker's cgroup limits
  // when SWC + webpack ran across all 28 cores at once.
  experimental: {
    webpackMemoryOptimizations: true,
  },
  async rewrites() {
    return [
      {
        source: "/prometheus/:path*",
        destination: "http://192.168.88.196:30104/:path*",
      },
    ];
  },
};

export default nextConfig;
