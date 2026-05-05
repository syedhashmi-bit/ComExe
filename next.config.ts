import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
