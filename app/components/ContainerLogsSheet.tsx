"use client";

import { useEffect, useRef, useState } from "react";

// ── ContainerLogsSheet ───────────────────────────────────────────────────────
// Side-sheet that shows the last 200 lines of a container's logs. Tail-follow
// is opt-in (off by default — saves the polling cost for users who just want a
// quick peek). Pulls via /api/docker/logs which talks to the Docker socket.

export function ContainerLogsSheet({ containerName, onClose }: { containerName: string; onClose: () => void }) {
  const [logs, setLogs]   = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [follow, setFollow]   = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/docker/logs?name=${encodeURIComponent(containerName)}&tail=200`, { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.ok) { setError(body.message ?? `HTTP ${res.status}`); setLoading(false); return; }
        setLogs(body.logs ?? "");
        setError(null);
        setLoading(false);
        // Scroll to bottom on each refresh
        requestAnimationFrame(() => {
          if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
        });
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      }
    }
    load();
    if (follow) {
      const id = setInterval(load, 3_000);
      return () => { cancelled = true; clearInterval(id); };
    }
    return () => { cancelled = true; };
  }, [containerName, follow]);

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col gap-3 p-5"
        style={{ width: 640, maxWidth: "90vw", background: "var(--settings-bg)", borderLeft: "1px solid var(--settings-border)", boxShadow: "-12px 0 40px rgba(0,0,0,0.7)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--settings-text)" }}>logs · {containerName}</span>
          <label className="flex items-center gap-1.5 cursor-pointer ml-auto" style={{ fontSize: 10, color: "var(--settings-text)" }}>
            <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
            <span>tail-follow</span>
          </label>
          <button onClick={onClose} style={{ color: "var(--settings-text-dim)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>

        {loading && <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>loading logs…</div>}
        {error && (
          <div style={{ fontSize: 11, color: "var(--critical)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "8px 10px" }}>
            {error}
          </div>
        )}
        {!loading && !error && (
          <pre ref={preRef}
            style={{
              flex: 1, margin: 0, overflow: "auto",
              fontSize: 11, fontFamily: "monospace", lineHeight: 1.5,
              background: "var(--bg)", color: "var(--text-dim)",
              border: "1px solid var(--border)", borderRadius: 6,
              padding: "10px 12px", whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >{logs || "(empty)"}</pre>
        )}
      </div>
    </>
  );
}
