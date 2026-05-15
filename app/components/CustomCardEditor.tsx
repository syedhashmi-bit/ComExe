"use client";

import { useEffect, useState } from "react";

interface CustomCardDef {
  id:       string;
  label:    string;
  query:    string;
  viz:      "sparkline" | "gauge" | "number" | "bar";
  color:    string;
  unit?:    string;
  position: number;
}

const VIZ_OPTIONS: { key: CustomCardDef["viz"]; label: string }[] = [
  { key: "sparkline", label: "Sparkline" },
  { key: "gauge",     label: "Gauge" },
  { key: "number",    label: "Number" },
  { key: "bar",       label: "Bar chart" },
];

const COLOR_PRESETS = ["#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#d946ef", "#f97316"];

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const emptyCard = (): CustomCardDef => ({
  id: uuid(), label: "", query: "", viz: "sparkline", color: "#06b6d4", unit: "", position: 0,
});

const inputStyle: React.CSSProperties = {
  background: "var(--settings-input, rgba(255,255,255,0.06))",
  border: "1px solid var(--border, rgba(255,255,255,0.08))",
  borderRadius: 6, padding: "7px 10px",
  color: "var(--text)", fontSize: 12,
  outline: "none", width: "100%", boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: "var(--text-label)", textTransform: "uppercase",
  letterSpacing: "0.08em", fontWeight: 600, marginBottom: 4,
};

export function CustomCardEditor({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<CustomCardDef[]>([]);
  const [editing, setEditing] = useState<CustomCardDef | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/custom-cards")
      .then(r => r.json())
      .then(d => setCards(d.cards ?? []))
      .catch(() => {});
  }, []);

  async function save(updated: CustomCardDef[]) {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/custom-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards: updated }),
      });
      const data = await res.json();
      if (data.ok) {
        setCards(updated);
        setMsg("Saved");
      } else {
        setMsg(data.message || "Save failed");
      }
    } catch {
      setMsg("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function testQuery(q: string) {
    setTestResult(null);
    try {
      const res = await fetch(`/api/custom-cards/query?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.error) setTestResult(`Error: ${data.error}`);
      else setTestResult(`Result: ${data.value}`);
    } catch (e) {
      setTestResult(`Error: ${(e as Error).message}`);
    }
  }

  function addCard() {
    const card = emptyCard();
    card.position = cards.length;
    setEditing(card);
  }

  function saveEditing() {
    if (!editing) return;
    const idx = cards.findIndex(c => c.id === editing.id);
    const updated = idx >= 0
      ? cards.map(c => c.id === editing.id ? editing : c)
      : [...cards, editing];
    save(updated);
    setEditing(null);
  }

  function removeCard(id: string) {
    save(cards.filter(c => c.id !== id));
  }

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 12, padding: 18,
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-label)" }}>
          Custom Cards
        </span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-ghost)", cursor: "pointer", fontSize: 14 }}>✕</button>
      </div>

      {!editing ? (
        <>
          {cards.length === 0 && (
            <div className="text-[11px]" style={{ color: "var(--text-dim)" }}>
              No custom cards yet. Add one to display a PromQL query on the dashboard.
            </div>
          )}
          {cards.map(c => (
            <div key={c.id} className="flex items-center gap-3" style={{
              background: "var(--surface-dim)", borderRadius: 8, padding: "8px 12px",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: c.color }} />
              <span className="text-[11px] font-medium" style={{ color: "var(--text)", flex: 1 }}>{c.label}</span>
              <span className="text-[9px]" style={{ color: "var(--text-ghost)" }}>{c.viz}</span>
              <button onClick={() => setEditing({ ...c })} style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: 10 }}>edit</button>
              <button onClick={() => removeCard(c.id)} style={{ background: "none", border: "none", color: "var(--critical)", cursor: "pointer", fontSize: 10 }}>remove</button>
            </div>
          ))}
          <button onClick={addCard} style={{
            background: "var(--brand)", color: "#000", border: "none",
            borderRadius: 6, padding: "8px 0", fontSize: 11, fontWeight: 600,
            cursor: "pointer",
          }}>+ Add card</button>
          {msg && <div className="text-[10px]" style={{ color: msg === "Saved" ? "var(--ok)" : "var(--critical)" }}>{msg}</div>}
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={labelStyle}>Label</div>
            <input value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} placeholder="e.g. RAM Free" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>PromQL Query</div>
            <input value={editing.query} onChange={e => setEditing({ ...editing, query: e.target.value })} placeholder="e.g. node_memory_MemFree_bytes / 1e9" style={{ ...inputStyle, fontFamily: "monospace" }} />
            <button onClick={() => testQuery(editing.query)} style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: 10, marginTop: 4 }}>
              Test query
            </button>
            {testResult && <div className="text-[10px] mt-1" style={{ color: testResult.startsWith("Error") ? "var(--critical)" : "var(--ok)" }}>{testResult}</div>}
          </div>
          <div>
            <div style={labelStyle}>Visualization</div>
            <div className="flex gap-2">
              {VIZ_OPTIONS.map(v => (
                <button key={v.key} onClick={() => setEditing({ ...editing, viz: v.key })} style={{
                  background: editing.viz === v.key ? "var(--brand)" : "var(--surface-dim)",
                  color: editing.viz === v.key ? "#000" : "var(--text-dim)",
                  border: "none", borderRadius: 4, padding: "5px 10px",
                  fontSize: 10, fontWeight: 600, cursor: "pointer",
                }}>{v.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Color</div>
            <div className="flex gap-2">
              {COLOR_PRESETS.map(c => (
                <button key={c} onClick={() => setEditing({ ...editing, color: c })} style={{
                  width: 22, height: 22, borderRadius: 6, background: c, border: editing.color === c ? "2px solid var(--text)" : "2px solid transparent",
                  cursor: "pointer",
                }} />
              ))}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Unit suffix (optional)</div>
            <input value={editing.unit ?? ""} onChange={e => setEditing({ ...editing, unit: e.target.value })} placeholder="e.g. %, °C, MB/s" style={{ ...inputStyle, width: 120 }} />
          </div>
          <div className="flex gap-2">
            <button onClick={saveEditing} disabled={!editing.label || !editing.query || saving} style={{
              background: "var(--brand)", color: "#000", border: "none",
              borderRadius: 6, padding: "8px 16px", fontSize: 11, fontWeight: 600,
              cursor: "pointer", opacity: !editing.label || !editing.query ? 0.5 : 1,
            }}>{saving ? "Saving…" : "Save card"}</button>
            <button onClick={() => { setEditing(null); setTestResult(null); }} style={{
              background: "var(--surface-dim)", color: "var(--text-dim)", border: "none",
              borderRadius: 6, padding: "8px 16px", fontSize: 11, cursor: "pointer",
            }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
