"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, PageTitle } from "@/app/components/PageHeader";

interface ContainerInfo {
  id: string;
  name: string;
  app: string;
  service: string | null;
  image: string;
  state: string;
  status: string;
}

// "ix-radarr-radarr-1" → "radarr", "ix-radarr-permissions-1" → "radarr · permissions".
// Falls back to the container name when two would read the same.
function containerLabels(list: ContainerInfo[]): Map<string, string> {
  const label = (c: ContainerInfo) => (!c.service || c.service === c.app ? c.app : `${c.app} · ${c.service}`);
  const seen = new Map<string, number>();
  for (const c of list) seen.set(label(c), (seen.get(label(c)) ?? 0) + 1);
  return new Map(list.map(c => [c.name, seen.get(label(c))! > 1 ? c.name : label(c)]));
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

// Docker prefixes every line with its own RFC 3339 timestamp (the route asks
// for timestamps=true), so each line showed its time twice. Show it once, in
// local time, and keep the line's own text.
const DOCKER_TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z /;
const TS_FMT: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false };

function parseLogs(raw: string): LogLine[] {
  return raw.split("\n").filter(l => l.trim()).map(line => {
    const m = line.match(DOCKER_TS);
    const text = m ? line.slice(m[0].length) : line;
    return {
      text,
      level: detectLevel(text),
      ts: m ? new Date(`${m[1]}Z`).toLocaleString([], TS_FMT) : extractTimestamp(text),
    };
  });
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
  const [hidden, setHidden] = useState<string[]>([]);
  const [disabled, setDisabled] = useState(false);
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
        if (d.hidden) setHidden(d.hidden);
        if (d.disabled) setDisabled(true);
        else if (d.message) setError(d.message);
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

  const labels = containerLabels(containers);
  const byLabel = (a: ContainerInfo, b: ContainerInfo) => labels.get(a.name)!.localeCompare(labels.get(b.name)!);
  const running = containers.filter(c => c.state === "running").sort(byLabel);
  const stopped = containers.filter(c => c.state !== "running").sort(byLabel);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      <PageHeader current="logs">

          {/* Container selector */}
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            style={{
              fontSize: 12, background: "var(--card)", color: "var(--text)",
              border: "1px solid var(--border-mid)", borderRadius: 6,
              padding: "5px 10px", outline: "none", minWidth: 160,
            }}
          >
            <option value="">Select container...</option>
            {running.length > 0 && (
              <optgroup label="Running">
                {running.map(c => (
                  <option key={c.id} value={c.name}>{labels.get(c.name)}</option>
                ))}
              </optgroup>
            )}
            {stopped.length > 0 && (
              <optgroup label="Stopped">
                {stopped.map(c => (
                  <option key={c.id} value={c.name}>{labels.get(c.name)}</option>
                ))}
              </optgroup>
            )}
          </select>

          {/* Tail count */}
          <select
            value={tailCount}
            onChange={e => setTailCount(Number(e.target.value))}
            style={{
              fontSize: 12, background: "var(--card)", color: "var(--text-dim)",
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
              aria-pressed={tailMode}
              style={{
                fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer",
                background: tailMode ? "var(--surface)" : "transparent",
                color: tailMode ? "var(--text)" : "var(--text-muted)",
                border: `1px solid ${tailMode ? "var(--border-hover)" : "var(--border)"}`,
                fontWeight: tailMode ? 600 : 400,
              }}
            >
              {tailMode ? "Tailing..." : "Tail"}
            </button>
            {/* Auto-scroll toggle */}
            <button
              onClick={() => setAutoScroll(a => !a)}
              aria-pressed={autoScroll}
              style={{
                fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer",
                background: autoScroll ? "var(--surface)" : "transparent",
                color: autoScroll ? "var(--text)" : "var(--text-muted)",
                border: `1px solid ${autoScroll ? "var(--border-hover)" : "var(--border)"}`,
                fontWeight: autoScroll ? 600 : 400,
              }}
            >
              Auto-scroll
            </button>
          </div>
      </PageHeader>

      {/* Toolbar */}
      <div className="px-3 sm:px-6 pt-6 pb-3 flex flex-col gap-4" style={{ maxWidth: 1560, margin: "0 auto" }}>
        <PageTitle title="Logs" description="Container logs with search, level filters and live tail." />
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search logs…"
              style={{
                width: "100%", fontSize: 12, background: "var(--card)",
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
                    fontSize: 12, padding: "5px 9px", borderRadius: 6, cursor: "pointer",
                    background: active ? (opt.key === "error" ? "color-mix(in srgb, var(--critical) 15%, transparent)" : opt.key === "warn" ? "color-mix(in srgb, var(--warn) 15%, transparent)" : "var(--surface)") : "transparent",
                    color: active ? (LEVEL_COLORS[opt.key === "all" ? "unknown" : opt.key] ?? "var(--text)") : "var(--text-muted)",
                    border: `1px solid ${active ? (opt.key === "error" ? "color-mix(in srgb, var(--critical) 30%, transparent)" : opt.key === "warn" ? "color-mix(in srgb, var(--warn) 30%, transparent)" : "var(--border-hover)") : "var(--border)"}`,
                    fontWeight: active ? 600 : 400,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {opt.label} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
                </button>
              );
            })}
          </div>

          <span style={{ fontSize: 12, color: "var(--text-ghost)", fontVariantNumeric: "tabular-nums" }}>
            {filtered.length} / {logs.length} lines
          </span>
        </div>
      </div>

      {/* Log output */}
      <div className="px-3 sm:px-6 pb-8" style={{ maxWidth: 1560, margin: "0 auto" }}>
        {disabled ? (
          <DockerSetup />
        ) : !selected ? (
          <div className="flex flex-col items-center justify-center gap-3" style={{ height: 400, color: "var(--text-ghost)" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
            <span style={{ fontSize: 13 }}>Select a container to view logs</span>
            <span style={{ fontSize: 12, maxWidth: 380, textAlign: "center", lineHeight: 1.6 }}>
              {containers.length === 0 && error
                ? error
                : `${containers.length} container${containers.length !== 1 ? "s" : ""} available`
              }
            </span>
            {hidden.length > 0 && (
              <span style={{ fontSize: 12, maxWidth: 480, textAlign: "center", lineHeight: 1.6 }}>
                Not in the allowlist: {hidden.join(", ")}. Add names to <span className="font-mono">COMEXE_DOCKER_ALLOW</span> to open their logs here.
              </span>
            )}
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
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.7,
            }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-ghost)", fontSize: 12 }}>
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
                            background: isHighlighted ? "color-mix(in srgb, var(--brand) 6%, transparent)" : "transparent",
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                          onMouseLeave={e => (e.currentTarget.style.background = isHighlighted ? "color-mix(in srgb, var(--brand) 6%, transparent)" : "transparent")}
                        >
                          <td style={{
                            padding: "2px 8px", width: 36,
                            color: "var(--text-ghost)", fontSize: 12, textAlign: "right",
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
                              padding: "2px 8px", whiteSpace: "nowrap", width: 1,
                              color: "var(--text-ghost)", fontSize: 12,
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

// Shown when the server has no Docker access: what to add to the container.
function DockerSetup() {
  // No ligatures: JetBrains Mono joins "--" into one long dash, and these get copied.
  const code = { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", fontVariantLigatures: "none" };
  const steps: [string, React.ReactNode][] = [
    ["Turn it on", <span key="e" style={code}>-e COMEXE_DOCKER_ENABLED=1</span>],
    ["Mount the socket", <span key="v" style={code}>-v /var/run/docker.sock:/var/run/docker.sock</span>],
    ["Let uid 1001 open it", <span key="g" style={code}>--group-add $(stat -c %g /var/run/docker.sock)</span>],
  ];
  return (
    <div style={{ maxWidth: 620, margin: "48px auto", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 20 }}>
      <div style={{ fontSize: 16, color: "var(--text)", fontWeight: 600 }}>Docker access is off</div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 6 }}>
        Logs and the services panel&apos;s restart buttons read the Docker socket, which ComExe only opens when asked to.
        Add these to the container&apos;s <span style={code}>docker run</span>:
      </p>
      <ol style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map(([label, value], i) => (
          <li key={label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1" style={{ fontSize: 13, color: "var(--text-muted)" }}>
            <span style={{ minWidth: 150 }}>{i + 1}. {label}</span>{value}
          </li>
        ))}
      </ol>
      <p style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.6, marginTop: 14 }}>
        In a TrueNAS app&apos;s YAML these are <span style={code}>environment</span>, <span style={code}>volumes</span> and <span style={code}>group_add</span> (INSTALL.md has the snippet);
        with <span style={code}>update-dashboard.sh</span>, <span style={code}>--enable-docker</span> adds all three.
        The socket is root-equivalent: only the dashboard&apos;s known services (plus <span style={code}>COMEXE_DOCKER_ALLOW</span>) can be read or restarted.
      </p>
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
        background: "color-mix(in srgb, var(--brand) 25%, transparent)", color: "var(--text)",
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
