"use client";

// Route-level error boundary for the dashboard segment. Next.js renders this in
// place of the page when the server or client render throws, instead of leaving
// a blank screen. `reset()` re-renders the segment; the reload button is the
// hard fallback when the error is sticky.

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard error boundary]", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0c12",
        color: "#e5e7eb",
        padding: 24,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#ef4444" }}>
          ComExe
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 12 }}>Something went wrong</h1>
        <p style={{ fontSize: 13, color: "rgba(229,231,235,0.6)", marginTop: 8, lineHeight: 1.5 }}>
          The dashboard hit an unexpected error while rendering. This is usually transient —
          retry, or reload the page.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <button
            onClick={reset}
            style={{
              fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8,
              background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)",
              color: "#06b6d4", cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)",
              color: "#e5e7eb", cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
