"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// ── Shared page chrome for the sub-pages ────────────────────────────────────
// Analytics, Forecast and Logs each hand-rolled a sticky bar with a cyan
// "← Dashboard" link and a bold title. They now share the dashboard's own
// look: the ComExe mark, the same page nav (current page marked), and a slot
// on the right for the page's controls. Same max width as the dashboard.

export type PageKey = "dashboard" | "analytics" | "forecast" | "logs";

const PAGES: { key: PageKey; href: string; label: string }[] = [
  { key: "dashboard", href: "/",          label: "Dashboard" },
  { key: "analytics", href: "/analytics", label: "Analytics" },
  { key: "forecast",  href: "/forecast",  label: "Forecast" },
  { key: "logs",      href: "/logs",      label: "Logs" },
];

export function ComExeMark({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32" style={{ flexShrink: 0 }}>
      {["M14 8 A 8 8 0 1 0 14 24", "M19 8 L25 8", "M19 8 L19 24", "M19 16 L24 16", "M19 24 L25 24"].map(d => (
        <path key={d} d={d} style={{ stroke: "var(--brand)" }} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      ))}
    </svg>
  );
}

export function PageHeader({ current, children }: { current: PageKey; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30" style={{ background: "var(--header-bg)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="flex flex-wrap items-center px-3 sm:px-6 py-3" style={{ maxWidth: 1560, margin: "0 auto", columnGap: 20, rowGap: 10 }}>
        <Link href="/" className="flex items-center" style={{ gap: 8, textDecoration: "none" }} aria-label="ComExe dashboard">
          <ComExeMark />
          <span className="font-mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
            Com<span style={{ color: "var(--brand)" }}>Exe</span>
          </span>
        </Link>
        <nav aria-label="Pages" className="flex items-center" style={{ gap: 16, fontSize: 13 }}>
          {PAGES.map(p => p.key === current ? (
            <Link key={p.key} href={p.href} aria-current="page" style={{ color: "var(--text)", fontWeight: 500, textDecoration: "none" }}>{p.label}</Link>
          ) : (
            <Link key={p.key} href={p.href} style={{ color: "var(--text-muted)", textDecoration: "none" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}>{p.label}</Link>
          ))}
        </nav>
        {children && <div className="flex flex-wrap items-center" style={{ marginLeft: "auto", gap: 8 }}>{children}</div>}
      </div>
    </header>
  );
}

// A page's title and one-line description, under the header.
export function PageTitle({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: 4 }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--text)" }}>{title}</h1>
      {description && <p style={{ margin: 0, fontSize: 13, color: "var(--text-label)", lineHeight: 1.5 }}>{description}</p>}
    </div>
  );
}

// Quiet segmented control (time ranges and the like): the selected option is a
// raised neutral chip, not a solid brand fill.
export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex" style={{ gap: 2, padding: 2, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-dim)" }}>
      {options.map(o => {
        const active = o.key === value;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.key)}
            style={{
              fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer", border: "none",
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--text-muted)",
              fontWeight: active ? 600 : 400, fontVariantNumeric: "tabular-nums",
              transition: "background 0.15s, color 0.15s",
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
