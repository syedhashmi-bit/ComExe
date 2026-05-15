"use client";

import { useState, useRef } from "react";

// ── DraggableCard ────────────────────────────────────────────────────────────
// Wraps a metric card with HTML5 drag-and-drop. The whole card is draggable;
// a hover-revealed ⋮⋮ icon in the top-right hints at this. To avoid the
// "click after drop fires the card's expand handler" footgun, we mark the
// post-dragend window and let consumers check `useDragSuppression()` if they
// need to. In practice, browsers already suppress click when dragstart fires,
// so this is rarely needed — but documented here for the next reader.

export function DraggableCard({
  cardKey, onReorder, children, disabled = false,
}: {
  cardKey: string;
  onReorder: (draggedKey: string, targetKey: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const [hover, setHover]       = useState(false);
  const [dragging, setDragging] = useState(false);
  const [over, setOver]         = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      draggable={!disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragStart={e => {
        if (disabled) return;
        e.dataTransfer.setData("text/x-comexe-card", cardKey);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => { setDragging(false); setOver(false); }}
      onDragOver={e => {
        if (disabled) return;
        // Must preventDefault to allow drop. Reading dataTransfer types lets us
        // ignore drags of unrelated content (files, text selections).
        if (!Array.from(e.dataTransfer.types).includes("text/x-comexe-card")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        if (disabled) return;
        const draggedKey = e.dataTransfer.getData("text/x-comexe-card");
        setOver(false);
        if (draggedKey && draggedKey !== cardKey) onReorder(draggedKey, cardKey);
      }}
      style={{
        position: "relative",
        opacity:  dragging ? 0.4 : 1,
        outline:  over ? "2px dashed var(--brand)" : "none",
        outlineOffset: -2,
        transition: "opacity 0.15s ease, outline 0.1s ease",
        cursor: disabled ? "default" : "grab",
      }}
    >
      {/* Visual drag affordance — shown on hover, top-right. Pointer events
          off so it doesn't intercept clicks on the card body. */}
      {!disabled && (
        <span
          aria-hidden
          style={{
            position: "absolute", top: 8, right: 10,
            fontSize: 14, color: "var(--text-faint)",
            opacity: hover ? 0.5 : 0,
            transition: "opacity 0.15s",
            pointerEvents: "none",
            zIndex: 2,
            letterSpacing: "-3px",
          }}
        >⋮⋮</span>
      )}
      {children}
    </div>
  );
}
