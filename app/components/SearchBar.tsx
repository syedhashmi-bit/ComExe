"use client";

import { useState } from "react";
import type { SearchEngine } from "@/app/lib/types";

export const SEARCH_ENGINES: Record<SearchEngine, { label: string; url: string; placeholder: string }> = {
  google:      { label: "Google",      url: "https://www.google.com/search?q=",   placeholder: "Search Google…" },
  bing:        { label: "Bing",        url: "https://www.bing.com/search?q=",     placeholder: "Search Bing…" },
  duckduckgo:  { label: "DuckDuckGo",  url: "https://duckduckgo.com/?q=",         placeholder: "Search DuckDuckGo…" },
  kagi:        { label: "Kagi",        url: "https://kagi.com/search?q=",         placeholder: "Search Kagi…" },
};

export function SearchEngineIcon({ engine, size = 16 }: { engine: SearchEngine; size?: number }) {
  if (engine === "google") return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
  if (engine === "bing") return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M5 3v16.5l4.67 2.5 8.33-4.5v-5L11.33 9l-2.33.83V5.5L5 3zm4.67 11.17l4.33 2.33-4.33 2.33v-4.66z" fill="#00809D"/>
    </svg>
  );
  if (engine === "duckduckgo") return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="11" fill="#DE5833"/>
      <circle cx="12" cy="12" r="7" fill="#fff"/>
      <circle cx="12" cy="12" r="3.5" fill="#DE5833"/>
    </svg>
  );
  // kagi
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#FFBE2E"/>
      <path d="M8 7h8v2H8zm0 4h8v2H8zm0 4h5v2H8z" fill="#1a1a1a"/>
    </svg>
  );
}

export function SearchBar({ inputRef, engine }: { inputRef: React.RefObject<HTMLInputElement | null>; engine: SearchEngine }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const cfg = SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.google;

  function doSearch() {
    const q = query.trim();
    if (q) window.open(`${cfg.url}${encodeURIComponent(q)}`, "_blank");
  }

  return (
    <div style={{ width: "100%", maxWidth: 600, margin: "0 auto" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "var(--surface-bright)",
          border: `1px solid ${focused ? "var(--brand-glow)" : "rgba(255,255,255,0.12)"}`,
          borderRadius: 999, padding: "10px 20px",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          boxShadow: focused ? "0 0 0 3px var(--brand-glow)" : "none",
          transform: focused ? "scale(1.01)" : "scale(1)",
          transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
        }}
      >
        <SearchEngineIcon engine={engine} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={cfg.placeholder}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") doSearch(); if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1, background: "none", border: "none", outline: "none",
            fontSize: 14, color: "var(--text)", fontFamily: "inherit",
            caretColor: "var(--brand)",
          }}
        />
        <button onClick={doSearch}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-faint)", display: "flex", transition: "color 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
