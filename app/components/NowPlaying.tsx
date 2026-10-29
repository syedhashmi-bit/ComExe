"use client";

import { useState } from "react";
import type { ServiceStream } from "@/app/lib/types";

// Plex streams from Tautulli, with each one's poster, who is watching on
// what, and how it's being delivered — direct play, or a transcode (and
// whether the GPU is doing it). Posters come through /api/plex-art so no API
// key or Plex token reaches the browser.

function Poster({ art, title }: { art?: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const box: React.CSSProperties = {
    width: 44, height: 66, borderRadius: 4, flexShrink: 0,
    background: "var(--surface)", border: "1px solid var(--border)",
  };
  if (!art || failed) {
    return (
      <span role="img" aria-label={`No artwork for ${title}`} className="flex items-center justify-center" style={box}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-ghost)" }}>
          <rect x="2" y="7" width="20" height="13" rx="2" /><path d="M17 2l-5 5-5-5" />
        </svg>
      </span>
    );
  }
  // 2× the box for sharp posters on high-DPI screens.
  // eslint-disable-next-line @next/next/no-img-element -- served by our own proxy route, already sized
  return <img src={`/api/plex-art?img=${encodeURIComponent(art)}&w=88&h=132`} alt={`Poster for ${title}`}
    width={44} height={66} loading="lazy" onError={() => setFailed(true)} style={{ ...box, objectFit: "cover" }} />;
}

const chip: React.CSSProperties = {
  fontSize: 12, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 4,
  padding: "1px 6px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
};

export const fmtMbps = (kbps: number) => `${(kbps / 1000).toFixed(kbps < 10_000 ? 1 : 0)} Mbps`;

export function NowPlaying({ streams }: { streams: ServiceStream[] }) {
  if (streams.length === 0) return null;
  const totalKbps = streams.reduce((s, x) => s + (x.bitrateKbps ?? 0), 0);
  const direct = streams.filter(s => s.decision === "Direct play" || s.decision === "Direct stream").length;
  const transcodes = streams.filter(s => s.decision === "Transcode");
  const onGpu = transcodes.filter(s => s.hwTranscode).length;
  const summary = streams.some(s => s.decision) ? [
    direct ? `${direct} direct` : null,
    transcodes.length ? `${transcodes.length} transcoding${onGpu === transcodes.length ? " on the GPU" : onGpu ? ` (${onGpu} on the GPU)` : ""}` : null,
  ].filter(Boolean).join(" · ") : "";

  return (
    <section aria-label="Now playing" style={{
      background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
      padding: 16, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent-speedtest)", flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Now playing · {streams.length} stream{streams.length !== 1 ? "s" : ""}</span>
        {totalKbps > 0 && <span className="ml-auto font-mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>{fmtMbps(totalKbps)} total</span>}
      </div>

      <ul className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0, gap: 12 }}>
        {streams.map((st, i) => (
          <li key={i} className="flex" style={{ gap: 12 }}>
            <Poster art={st.art} title={st.title} />
            <div className="flex flex-col flex-1 min-w-0" style={{ gap: 5 }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate" title={st.title} style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{st.title}</span>
                {st.posStr && <span className="font-mono shrink-0" style={{ fontSize: 12, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{st.posStr}</span>}
              </div>
              <span className="truncate" style={{ fontSize: 12, color: "var(--text-faint)" }}>
                {st.user}{st.player ? ` · ${st.player}` : ""}{st.paused ? " · Paused" : ""}
              </span>
              {(st.decision || st.quality || st.bitrateKbps) && (
                <div className="flex flex-wrap" style={{ gap: 6 }}>
                  {st.decision && <span style={chip}>{st.decision}{st.hwTranscode ? " · GPU" : ""}</span>}
                  {st.quality && <span className="font-mono" style={chip}>{st.quality}</span>}
                  {st.bitrateKbps ? <span className="font-mono" style={chip}>{fmtMbps(st.bitrateKbps)}</span> : null}
                </div>
              )}
              <div style={{ marginTop: "auto", height: 3, background: "var(--gauge-track)", borderRadius: 2 }}>
                <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(100, st.progress)}%`, background: "var(--data-strong)" }} />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {summary && (
        <span style={{ fontSize: 12, color: "var(--text-faint)", paddingTop: 10, borderTop: "1px solid var(--divider)" }}>{summary}</span>
      )}
    </section>
  );
}
