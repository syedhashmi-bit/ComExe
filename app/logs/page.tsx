"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

interface LogLine {
  text: string;
  level: "error" | "warn" | "info" | "debug" | "unknown";
  ts: string | null;
}

type LevelFilter = "all" | "error" | "warn" | "info" | "debug";

function detectLevel(line: string): LogLine["level"] {
  const l = line.toLowerCase();
  if (/\berr(or)?\b|fatal|panic|exception|traceback|critical/i.test(l)) return "error";
  if (/\bwarn(ing)?\b/i.test(l)) return "warn";
  if (/\bdebug\b/i.test(l)) return "debug";
  if (/\binfo\b/i.test(l)) return "info";
  return "unknown";
}

function extractTimestamp(line: string): string | null {
  const isoMatch = line.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/);
  if (isoMatch) return isoMatch[0];
  const shortMatch = line.match(/\d{2}:\d{2}:\d{2}/);
  if (shortMatch) return shortMatch[0];
  return null;
}

function parseLogs(raw: string): LogLine[] {
  return raw.split("\n").filter(l => l.trim()).map(text => ({
    text,
    level: detectLevel(text),
    ts: extractTimestamp(text),
  }));
}

const LEVEL_COLORS: Record<LogLine["level"], string> = {
  error: "var(--critical)",
  warn: "var(--warn)",
  info: "var(--brand)",
  debug: "var(--text-ghost)",
  unknown: "var(--text-dim)",
};

const LEVEL_OPTIONS: { key: LevelFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "error", label: "Errors" },
  { key: "warn", label: "Warnings" },
  { key: "info", label: "Info" },
  { key: "debug", label: "Debug" },
];

export default function LogsPage() {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [tailMode, setTailMode] = useState(false);
  const [tailCount, setTailCount] = useState(500);
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const tailIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch container list
  useEffect(() => {
    fetch("/api/docker/containers")
      .then(r => r.json())
      .then(d => {
        if (d.containers) setContainers(d.containers);
        if (d.message) setError(d.message);
      })
      .catch(e => setError(e.message));
  }, []);

  const fetchLogs = useCallback(async (name: string, tail: number) => {
    if (!name) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/docker/logs?name=${encodeURIComponent(name)}&tail=${tail}`);
      const data = await res.json();
      if (data.ok && data.logs) {
        setLogs(parseLogs(data.logs));
        setError(null);
      } else {
        setError(data.message ?? "Failed to fetch logs");
        setLogs([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load logs when container selection changes
  useEffect(() => {
    if (selected) fetchLogs(selected, tailCount);
  }, [selected, tailCount, fetchLogs]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Tail mode — poll every 3s
  useEffect(() => {
    if (tailIntervalRef.current) clearInterval(tailIntervalRef.current);
    if (tailMode && selected) {
      tailIntervalRef.current = setInterval(() => fetchLogs(selected, tailCount), 3000);
    }
    return () => { if (tailIntervalRef.current) clearInterval(tailIntervalRef.current); };
  }, [tailMode, selected, tailCount, fetchLogs]);

  // Filter logs
  const filtered = logs.filter(l => {
    if (levelFilter !== "all" && l.level !== levelFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return l.text.toLowerCase().includes(q);
    }
    return true;
  });

  const levelCounts = {
    error: logs.filter(l => l.level === "error").length,
    warn: logs.filter(l => l.level === "warn").length,
    info: logs.filter(l => l.level === "info").length,
    debug: logs.filter(l => l.level === "debug").length,
  };

  const running = containers.filter(c => c.state === "running");
  const stopped = containers.filter(c => c.state !== "running");

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      {/* Header */}
      <div className="sticky top-0 z-30" style={{ background: "var(--header-bg)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--border-dim)" }}>
        <div className="flex items-center gap-4 px-6 py-3" style={{ maxWidth: 1400, margin: "0 auto" }}>
          <Link href="/" style={{ color: "var(--brand)", textDecoration: "none", fontSize: 12, fontWeight: 600 }}>
            &larr; Dashboard
          </Link>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.02em" }}>Log Viewer</span>

          {/* Container selector */}
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            style={{
              fontSize: 11, background: "var(--card)", color: "var(--text)",
              border: "1px solid var(--border-mid)", borderRadius: 6,
              padding: "5px 10px", outline: "none", minWidth: 160,
            }}
          >
            <option value="">Select container...</option>
            {running.length > 0 && (
              <optgroup label="Running">
                {running.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </optgroup>
            )}
            {stopped.length > 0 && (
              <optgroup label="Stopped">
                {stopped.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </optgroup>
            )}
          </select>

          {/* Tail count */}
          <select
            value={tailCount}
            onChange={e => setTailCount(Number(e.target.value))}
            style={{
              fontSize: 10, background: "var(--card)", color: "var(--text-dim)",
              border: "1px solid var(--border-mid)", borderRadius: 5,
              padding: "4px 8px", outline: "none",
            }}
          >
            <option value={100}>100 lines</option>
            <option value={200}>200 lines</option>
            <option value={500}>500 lines</option>
            <option value={1000}>1000 lines</option>
            <option value={2000}>2000 lines</option>
          </select>

          <div className="flex gap-2 ml-auto">
            {/* Tail toggle */}
            <button
              onClick={() => setTailMode(t => !t)}
              style={{
                fontSize: 10, padding: "4px 10px", borderRadius: 5, cursor: "pointer",
                background: tailMode ? "var(--brand)" : "var(--card)",
                color: tailMode ? "var(--bg)" : "var(--text-dim)",
                border: `1px solid ${tailMode ? "var(--brand)" : "var(--border)"}`,
                fontWeight: tailMode ? 700 : 400,
              }}
            >
              {tailMode ? "Tailing..." : "Tail"}
            </button>
            {/* Auto-scroll toggle */}
            <button
              onClick={() => setAutoScroll(a => !a)}
              style={{
                fontSize: 10, padding: "4px 10px", borderRadius: 5, cursor: "pointer",
                background: autoScroll ? "rgba(16,185,129,0.15)" : "var(--card)",
                color: autoScroll ? "var(--ok)" : "var(--text-dim)",
                border: `1px solid ${autoScroll ? "rgba(16,185,129,0.3)" : "var(--border)"}`,
              }}
            >
              Auto-scroll
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3" style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search logs... (regex supported)"
              style={{
                width: "100%", fontSize: 11, background: "var(--card)",
                color: "var(--text)", border: "1px solid var(--border-mid)",
                borderRadius: 6, padding: "7px 12px 7px 30px", outline: "none",
                fontFamily: "monospace",
              }}
            />
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-ghost)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>

          {/* Level filter pills */}
          <div className="flex gap-1">
            {LEVEL_OPTIONS.map(opt => {
              const count = opt.key === "all" ? logs.length : levelCounts[opt.key as keyof typeof levelCounts] ?? 0;
              const active = levelFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setLevelFilter(opt.key)}
                  style={{
                    fontSize: 9, padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                    background: active ? (opt.key === "error" ? "rgba(239,68,68,0.15)" : opt.key === "warn" ? "rgba(245,158,11,0.15)" : "var(--surface-bright)") : "var(--card)",
                    color: active ? (LEVEL_COLORS[opt.key === "all" ? "unknown" : opt.key] ?? "var(--text)") : "var(--text-ghost)",
                    border: `1px solid ${active ? (opt.key === "error" ? "rgba(239,68,68,0.3)" : opt.key === "warn" ? "rgba(245,158,11,0.3)" : "var(--border-mid)") : "var(--border-dim)"}`,
                    fontWeight: active ? 600 : 400,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {opt.label} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
                </button>
              );
            })}
          </div>

          <span style={{ fontSize: 10, color: "var(--text-ghost)", fontVariantNumeric: "tabular-nums" }}>
            {filtered.length} / {logs.length} lines
          </span>
        </div>
      </div>

      {/* Log output */}
      <div className="px-6 pb-8" style={{ maxWidth: 1400, margin: "0 auto" }}>
        {!selected ? (
          <div className="flex flex-col items-center justify-center gap-3" style={{ height: 400, color: "var(--text-ghost)" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
            <span style={{ fontSize: 13 }}>Select a container to view logs</span>
            <span style={{ fontSize: 11, maxWidth: 380, textAlign: "center", lineHeight: 1.6 }}>
              {containers.length === 0 && error
                ? error
                : `${containers.length} container${containers.length !== 1 ? "s" : ""} available`
              }
            </span>
          </div>
        ) : loading && logs.length === 0 ? (
          <div className="flex items-center justify-center" style={{ height: 400, color: "var(--text-ghost)", fontSize: 12 }}>
            Loading logs for {selected}...
          </div>
        ) : error && logs.length === 0 ? (
          <div className="flex items-center justify-center" style={{ height: 400, color: "var(--critical)", fontSize: 12 }}>
            {error}
          </div>
        ) : (
          <div style={{
            background: "var(--card)", border: "1px solid var(--border-subtle)",
            borderRadius: 10, overflow: "hidden",
          }}>
            <div style={{
              maxHeight: "calc(100vh - 220px)", overflowY: "auto",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.7,
            }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-ghost)", fontSize: 11 }}>
                  {search ? "No logs match your search" : "No log lines to display"}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {filtered.map((line, i) => {
                      const isHighlighted = search && line.text.toLowerCase().includes(search.toLowerCase());
                      return (
                        <tr
                          key={i}
                          style={{
                            borderBottom: "1px solid var(--border-dim)",
                            background: isHighlighted ? "rgba(6,182,212,0.06)" : "transparent",
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                          onMouseLeave={e => (e.currentTarget.style.background = isHighlighted ? "rgba(6,182,212,0.06)" : "transparent")}
                        >
                          <td style={{
                            padding: "2px 8px", width: 36,
                            color: "var(--text-ghost)", fontSize: 9, textAlign: "right",
                            userSelect: "none", verticalAlign: "top",
                          }}>
                            {i + 1}
                          </td>
                          <td style={{
                            padding: "2px 4px", width: 4,
                            verticalAlign: "top",
                          }}>
                            <span style={{
                              display: "inline-block", width: 3, height: 3,
                              borderRadius: "50%", marginTop: 7,
                              background: LEVEL_COLORS[line.level],
                              boxShadow: line.level === "error" ? `0 0 4px ${LEVEL_COLORS.error}` : "none",
                            }} />
                          </td>
                          {line.ts && (
                            <td style={{
                              padding: "2px 8px", whiteSpace: "nowrap",
                              color: "var(--text-ghost)", fontSize: 10,
                              verticalAlign: "top", fontVariantNumeric: "tabular-nums",
                            }}>
                              {line.ts}
                            </td>
                          )}
                          <td style={{
                            padding: "2px 12px",
                            color: line.level === "error" ? LEVEL_COLORS.error
                              : line.level === "warn" ? LEVEL_COLORS.warn
                              : "var(--text-muted)",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                            fontWeight: line.level === "error" ? 600 : 400,
                          }}>
                            {search ? highlightSearch(line.text, search) : line.text}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function highlightSearch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let lastIndex = 0;
  let idx = lower.indexOf(q, lastIndex);
  let keyCounter = 0;
  while (idx !== -1) {
    if (idx > lastIndex) parts.push(text.slice(lastIndex, idx));
    parts.push(
      <mark key={keyCounter++} style={{
        background: "rgba(6,182,212,0.25)", color: "var(--brand)",
        borderRadius: 2, padding: "0 1px",
      }}>
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    lastIndex = idx + query.length;
    idx = lower.indexOf(q, lastIndex);
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
