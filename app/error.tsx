"use client";

// Route-level error boundary for the dashboard segment. Next.js renders this in
// place of the page when the server or client render throws, instead of leaving
// a blank screen. `reset()` re-renders the segment; the reload button is the
// hard fallback when the error is sticky. It renders inside the root layout, so
// the theme tokens apply (global-error.tsx does not get them).

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
        background: "var(--bg)",
        color: "var(--text)",
        padding: 24,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>
          ComExe
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 12 }}>Something went wrong</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
          The dashboard hit an unexpected error while rendering. This is usually transient —
          retry, or reload the page.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <button
            onClick={reset}
            style={{
              fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8,
              background: "var(--brand)", border: "1px solid var(--brand)",
              color: "var(--bg)", cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8,
              background: "var(--surface)", border: "1px solid var(--border-mid)",
              color: "var(--text)", cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
