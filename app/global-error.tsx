"use client";

// Last-resort boundary for errors thrown in the root layout itself (where the
// segment-level error.tsx can't help). It replaces the whole document, so it
// must render its own <html>/<body>. Kept dependency-free and inline-styled
// since globals.css / fonts may not have loaded when this fires.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0c12",
          color: "#e5e7eb",
          padding: 24,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#ef4444" }}>
            ComExe
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 12 }}>Dashboard failed to load</h1>
          <p style={{ fontSize: 13, color: "rgba(229,231,235,0.6)", marginTop: 8, lineHeight: 1.5 }}>
            A fatal error occurred before the dashboard could render. Reload to try again.
          </p>
          <button
            onClick={reset}
            style={{
              fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8, marginTop: 20,
              background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)",
              color: "#06b6d4", cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
