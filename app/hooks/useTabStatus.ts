"use client";

import { useEffect } from "react";

// Mirrors the status summary in the browser tab: "2 issues · ComExe" and a
// warning/critical dot on the tab icon, back to plain "ComExe" when all is
// well — so a pinned tab says something's wrong without being looked at.
//
// The icon is the app's own mark (app/icon.svg) with a dot added; the colours
// are the Midnight theme's, since a favicon can't read CSS variables.

const MARK = `<g stroke="#06b6d4" stroke-width="2.6" fill="none" stroke-linecap="round">`
  + `<path d="M14 8 A 8 8 0 1 0 14 24"/><path d="M19 8 L25 8"/><path d="M19 8 L19 24"/>`
  + `<path d="M19 16 L24 16"/><path d="M19 24 L25 24"/></g>`;

const DOT = { warning: "#d29922", critical: "#f85149" } as const;

export function statusIcon(level: "warning" | "critical"): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${MARK}`
    + `<circle cx="25" cy="25" r="6.5" fill="${DOT[level]}" stroke="#0c0d10" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function statusTitle(count: number): string {
  return count === 0 ? "ComExe" : `${count} ${count === 1 ? "issue" : "issues"} · ComExe`;
}

function setIcon(level: "warning" | "critical" | null) {
  document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach(link => {
    link.dataset.baseHref ??= link.href;
    link.href = level ? statusIcon(level) : link.dataset.baseHref;
  });
}

// `issues` is null until there's data to judge by; the tab is left alone then.
export function useTabStatus(issues: { level: "warning" | "critical" }[] | null): void {
  const count = issues?.length ?? null;
  const level = !issues || issues.length === 0 ? null
    : issues.some(i => i.level === "critical") ? "critical" : "warning";

  useEffect(() => {
    if (count == null) return;
    document.title = statusTitle(count);
    setIcon(level);
  }, [count, level]);

  // Leaving the dashboard (Analytics, Logs, …) puts the plain icon back.
  useEffect(() => () => setIcon(null), []);
}
