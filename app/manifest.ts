import type { MetadataRoute } from "next";

// ── Web App Manifest ─────────────────────────────────────────────────────────
// Next.js 15 auto-serves this at /manifest.webmanifest. Lets users "Add to
// Home Screen" on phones and "Install app" on Chrome/Edge desktop. No service
// worker yet — that comes later for offline shell support. Without a SW we
// don't get the install prompt as aggressively but the app does install
// when the browser feels like offering it.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             "ComExe",
    short_name:       "ComExe",
    description:      "Homelab metrics dashboard",
    start_url:        "/",
    display:          "standalone",
    background_color: "#0a0c12",
    theme_color:      "#06b6d4",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
