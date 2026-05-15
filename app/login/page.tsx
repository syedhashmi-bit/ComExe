"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth/status")
      .then(r => r.json())
      .then(data => {
        if (!data.enabled || data.authenticated) {
          router.replace(searchParams.get("from") ?? "/");
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [router, searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok) {
        router.replace(searchParams.get("from") ?? "/");
      } else {
        setError(data.message || "Login failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div style={{
        minHeight: "100vh", background: "var(--bg, #0a0c12)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ color: "var(--text-ghost, #666)", fontSize: 13 }}>checking auth…</span>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg, #0a0c12)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--card, rgba(255,255,255,0.04))",
          border: "1px solid var(--border, rgba(255,255,255,0.06))",
          borderRadius: 16, padding: "36px 32px", width: 360,
          display: "flex", flexDirection: "column", gap: 18,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--brand, #06b6d4)", marginBottom: 4 }}>
            ComExe
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim, #888)" }}>
            Enter the dashboard password to continue
          </div>
        </div>

        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            background: "var(--settings-input, rgba(255,255,255,0.06))",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
            borderRadius: 8, padding: "10px 14px",
            color: "var(--text, #e2e8f0)", fontSize: 14,
            outline: "none", width: "100%", boxSizing: "border-box",
          }}
        />

        {error && (
          <div style={{
            fontSize: 12, color: "var(--critical, #ef4444)",
            background: "rgba(239,68,68,0.08)", borderRadius: 6,
            padding: "8px 12px",
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          style={{
            background: "var(--brand, #06b6d4)", color: "#000",
            border: "none", borderRadius: 8, padding: "10px 0",
            fontSize: 13, fontWeight: 600, cursor: loading ? "wait" : "pointer",
            opacity: loading || !password ? 0.5 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <div style={{ fontSize: 10, color: "var(--text-ghost, #555)", textAlign: "center", lineHeight: 1.5 }}>
          Set <code style={{ color: "var(--brand, #06b6d4)" }}>DASHBOARD_PASSWORD</code> env
          var on the container to enable this lock screen.
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: "100vh", background: "var(--bg, #0a0c12)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ color: "var(--text-ghost, #666)", fontSize: 13 }}>loading…</span>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
