"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

// ── Modal ────────────────────────────────────────────────────────────────────
// One dialog shell for every overlay in the app.
//
// Two problems it solves at once.
//
// 1. DUPLICATION. NetworkTopology, ServerFleetPanel and DependencyMap each
//    carried a byte-for-byte copy of the same chrome — same centring transform,
//    same `min(Npx, calc(100vw - 40px))`, same `calc(100vh - 80px)` cap, same
//    card/border/radius/shadow, same header row, same close button. Two more
//    variants existed in KeyboardShortcuts and CommandPalette with different
//    shadow alphas.
//
// 2. ACCESSIBILITY. There was no `role="dialog"` or `aria-modal` anywhere in
//    the codebase — a screen reader had no way to know an overlay had opened.
//    Nothing trapped focus, so Tab walked straight out of the dialog into the
//    page behind it. Nothing restored focus to the trigger on close. Four of
//    the nine overlays didn't close on Escape at all (page.tsx cleared only
//    four of the eight overlay states), leaving them mouse-only to dismiss.
//    The background also scrolled behind an open dialog.
//
// Backdrop click still closes — that is a convenience, not the accessible path,
// which is why Escape and the labelled close button both exist.

export interface ModalProps {
  onClose: () => void;
  // Accessible name, wired to aria-labelledby. Also rendered as the heading.
  title: string;
  // Optional element beside the title (a count, an icon, a badge).
  titleExtra?: ReactNode;
  icon?: ReactNode;
  // CSS width expression for the dialog. Defaults to the 900px most panels use.
  width?: string;
  // Control rendered to the left of the close button (e.g. ServerFleetPanel's
  // "+ Add"). Kept inside the dialog so the focus trap covers it.
  headerAction?: ReactNode;
  children: ReactNode;
}

// Elements that can hold focus. Used for the Tab cycle.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ onClose, title, titleExtra, icon, width, headerAction, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // useId, not a random ref: reading ref.current during render is a refs
  // violation and Math.random() is impure there. useId is the API meant for
  // exactly this — a stable, SSR-safe id to hang aria-labelledby off.
  const headingId = useId();

  useEffect(() => {
    // Remember what had focus so it can be handed back on close — otherwise a
    // keyboard user is dumped at the top of the document every time.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog. Prefer the first control; fall back to the
    // panel itself (it carries tabIndex={-1} for exactly this).
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    // Lock background scroll, restoring whatever was there before rather than
    // assuming "" — a nested or subsequent modal would otherwise clear it.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null); // skip hidden controls
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last  = items[items.length - 1];
      // Wrap at both ends so focus can never leave the dialog.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="fixed z-50"
        style={{
          top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: width ?? "min(900px, calc(100vw - 40px))",
          maxHeight: "calc(100vh - 80px)",
          background: "var(--card)", border: "1px solid var(--border-bright)",
          borderRadius: 14, overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          display: "flex", flexDirection: "column",
          outline: "none",
        }}
      >
        <div className="flex items-center justify-between gap-2 p-4" style={{ borderBottom: "1px solid var(--border-dim)" }}>
          <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
            {icon}
            <h2 id={headingId} style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: 0 }}>
              {title}
            </h2>
            {titleExtra}
          </div>
          <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
            {headerAction}
            <button
              onClick={onClose}
              aria-label={`Close ${title}`}
              style={{ color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
            >
              &times;
            </button>
          </div>
        </div>

        {children}
      </div>
    </>
  );
}
