"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkline, GaugeBar, BigValue } from "@/app/components/primitives";

interface CustomCardDef {
  id:       string;
  label:    string;
  query:    string;
  viz:      "sparkline" | "gauge" | "number" | "bar";
  color:    string;
  unit?:    string;
  position: number;
}

interface CardState {
  value:   number | null;
  history: number[];
  error?:  string;
}

function CustomCardRenderer({ card, state }: { card: CustomCardDef; state: CardState }) {
  const fmt = (v: number | null) => v != null ? `${Math.round(v * 10) / 10}${card.unit ?? ""}` : "—";

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 14, padding: 18, backdropFilter: "blur(6px)",
      display: "flex", flexDirection: "column", gap: 10,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${card.color}, ${card.color}99, ${card.color}33)`,
      }} />
      <div className="flex items-center gap-2">
        <span style={{ width: 6, height: 6, borderRadius: 3, background: card.color }} />
        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-label)" }}>
          {card.label}
        </span>
      </div>

      {state.error ? (
        <div className="text-[10px]" style={{ color: "var(--critical)" }}>{state.error}</div>
      ) : card.viz === "number" ? (
        <div style={{ color: card.color }}>
          <BigValue value={fmt(state.value)} />
        </div>
      ) : card.viz === "gauge" ? (
        <div>
          <div className="text-[22px] font-bold font-mono" style={{ color: card.color }}>
            {fmt(state.value)}
          </div>
          <GaugeBar percent={state.value ?? 0} color={card.color} thin />
        </div>
      ) : card.viz === "bar" ? (
        <div>
          <div className="text-[14px] font-bold font-mono" style={{ color: card.color }}>
            {fmt(state.value)}
          </div>
          <div style={{ display: "flex", gap: 2, height: 40, alignItems: "flex-end", marginTop: 8 }}>
            {state.history.slice(-20).map((v, i) => {
              const max = Math.max(...state.history.slice(-20), 1);
              return (
                <div key={i} style={{
                  flex: 1, background: card.color,
                  height: `${Math.max(2, (v / max) * 100)}%`,
                  borderRadius: 2, opacity: 0.7 + (i / 20) * 0.3,
                }} />
              );
            })}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-[14px] font-bold font-mono" style={{ color: card.color }}>
            {fmt(state.value)}
          </div>
          <div style={{ height: 50 }}>
            <Sparkline data={state.history.slice(-60)} color={card.color} height={50} />
          </div>
        </div>
      )}
    </div>
  );
}

export function CustomCardsGrid({ refreshInterval }: { refreshInterval: number }) {
  const [cards, setCards] = useState<CustomCardDef[]>([]);
  const [states, setStates] = useState<Record<string, CardState>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load card definitions once
  useEffect(() => {
    fetch("/api/custom-cards")
      .then(r => r.json())
      .then(d => setCards(d.cards ?? []))
      .catch(() => {});
  }, []);

  // Poll each card's PromQL query
  useEffect(() => {
    if (cards.length === 0) return;
    const poll = async () => {
      const next: Record<string, CardState> = { ...states };
      await Promise.all(cards.map(async (card) => {
        try {
          const res = await fetch(`/api/custom-cards/query?q=${encodeURIComponent(card.query)}`);
          const data = await res.json();
          if (data.error) {
            next[card.id] = { ...next[card.id], value: null, history: next[card.id]?.history ?? [], error: data.error };
          } else {
            const prev = next[card.id]?.history ?? [];
            const history = [...prev, data.value ?? 0].slice(-60);
            next[card.id] = { value: data.value, history, error: undefined };
          }
        } catch (e) {
          next[card.id] = { ...next[card.id], value: null, history: next[card.id]?.history ?? [], error: (e as Error).message };
        }
      }));
      setStates({ ...next });
    };

    poll();
    pollRef.current = setInterval(poll, refreshInterval * 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, refreshInterval]);

  if (cards.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
      {cards.map(card => (
        <CustomCardRenderer
          key={card.id}
          card={card}
          state={states[card.id] ?? { value: null, history: [] }}
        />
      ))}
    </div>
  );
}
