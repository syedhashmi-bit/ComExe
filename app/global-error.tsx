"use client";

// Last-resort boundary for errors thrown in the root layout itself (where the
// segment-level error.tsx can't help). It replaces the whole document, so it
// must render its own <html>/<body>. Kept dependency-free and inline-styled
// since globals.css / fonts may not have loaded when this fires. The hex
// values are the Midnight theme tokens.

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
          background: "#0c0d10",
          color: "#e6e8eb",
          padding: 24,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#a3a9b3" }}>
            ComExe
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 12 }}>Dashboard failed to load</h1>
          <p style={{ fontSize: 13, color: "#a3a9b3", marginTop: 8, lineHeight: 1.5 }}>
            A fatal error occurred before the dashboard could render. Reload to try again.
          </p>
          <button
            onClick={reset}
            style={{
              fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8, marginTop: 20,
              background: "#22b8cf", border: "1px solid #22b8cf",
              color: "#0c0d10", cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
