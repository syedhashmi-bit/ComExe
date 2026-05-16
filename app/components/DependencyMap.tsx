"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface DependencyEdge {
  from: string;
  to: string;
  label?: string;
}

interface ServiceStatus {
  name: string;
  up: boolean;
  configured: boolean;
}

interface DependencyMapProps {
  onClose: () => void;
  services: ServiceStatus[];
}

const SVC_COLORS: Record<string, string> = {
  radarr: "#ffc230", sonarr: "#00ccff", bazarr: "#e6a817", tautulli: "#cc7b19",
  qbittorrent: "#4a90d9", overseerr: "#6366f1", prowlarr: "#f9802d",
  pihole: "#96060c", nginx: "#009639", uptimekuma: "#5cdd8b",
  plex: "#e5a00d", grafana: "#f97316", prometheus: "#e6522c",
};

function getColor(name: string): string {
  return SVC_COLORS[name.toLowerCase()] ?? "var(--text-ghost)";
}

export function DependencyMap({ onClose, services }: DependencyMapProps) {
  const [deps, setDeps] = useState<DependencyEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const fetchDeps = useCallback(async () => {
    try {
      const res = await fetch("/api/dependencies");
      if (!res.ok) return;
      const data = await res.json();
      setDeps(data.dependencies ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDeps(); }, [fetchDeps]);

  const statusMap = useMemo(() => {
    const map = new Map<string, { up: boolean; configured: boolean }>();
    for (const s of services) {
      map.set(s.name, { up: s.up, configured: s.configured !== false });
    }
    return map;
  }, [services]);

  // Build the graph layout
  const { nodes, nodePositions, svgWidth, svgHeight } = useMemo(() => {
    const allNames = new Set<string>();
    for (const d of deps) {
      allNames.add(d.from);
      allNames.add(d.to);
    }
    const names = Array.from(allNames);

    // Compute layers via topological sort (dependents first)
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const d of deps) {
      outgoing.set(d.from, [...(outgoing.get(d.from) ?? []), d.to]);
      incoming.set(d.to, [...(incoming.get(d.to) ?? []), d.from]);
    }

    // Assign layers: nodes with no outgoing deps = layer 0 (bottom)
    const layers = new Map<string, number>();
    const visited = new Set<string>();

    function assignLayer(name: string): number {
      if (layers.has(name)) return layers.get(name)!;
      if (visited.has(name)) return 0; // cycle protection
      visited.add(name);
      const targets = outgoing.get(name) ?? [];
      const maxChild = targets.length > 0 ? Math.max(...targets.map(assignLayer)) + 1 : 0;
      layers.set(name, maxChild);
      return maxChild;
    }
    names.forEach(assignLayer);

    // Group by layer
    const layerGroups = new Map<number, string[]>();
    for (const [name, layer] of layers.entries()) {
      const existing = layerGroups.get(layer) ?? [];
      existing.push(name);
      layerGroups.set(layer, existing);
    }

    const numLayers = Math.max(...Array.from(layerGroups.keys()), 0) + 1;
    const maxPerLayer = Math.max(...Array.from(layerGroups.values()).map(g => g.length), 1);

    const nodeSpaceX = 140;
    const nodeSpaceY = 110;
    const w = Math.max(maxPerLayer * nodeSpaceX + 80, 500);
    const h = numLayers * nodeSpaceY + 80;

    const positions = new Map<string, { x: number; y: number }>();
    for (const [layer, group] of layerGroups.entries()) {
      const y = (numLayers - 1 - layer) * nodeSpaceY + 50;
      const startX = (w - group.length * nodeSpaceX) / 2 + nodeSpaceX / 2;
      group.forEach((name, i) => {
        positions.set(name, { x: startX + i * nodeSpaceX, y });
      });
    }

    return { nodes: names, nodePositions: positions, svgWidth: w, svgHeight: h };
  }, [deps]);

  // Compute impact chain: if a node is down, which dependents are affected?
  const impactedNodes = useMemo(() => {
    const impacted = new Set<string>();
    if (!hoveredNode) return impacted;

    const status = statusMap.get(hoveredNode);
    if (!status || status.up) return impacted;

    // BFS: find all nodes that depend on hoveredNode
    const queue = [hoveredNode];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const d of deps) {
        if (d.to === current && !visited.has(d.from)) {
          impacted.add(d.from);
          queue.push(d.from);
        }
      }
    }
    return impacted;
  }, [hoveredNode, deps, statusMap]);

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div className="fixed z-50" style={{
        top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: "min(900px, calc(100vw - 40px))", maxHeight: "calc(100vh - 80px)",
        background: "var(--card)", border: "1px solid var(--border-bright)",
        borderRadius: 14, overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        display: "flex", flexDirection: "column",
      }}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid var(--border-dim)" }}>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Dependency Map</span>
            <span style={{ fontSize: 10, color: "var(--text-ghost)" }}>
              {nodes.length} services, {deps.length} dependencies
            </span>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>
            &times;
          </button>
        </div>

        <div style={{ overflow: "auto", flex: 1, padding: 16 }}>
          {loading ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-ghost)", fontSize: 12 }}>
              Loading dependency graph...
            </div>
          ) : nodes.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-ghost)", fontSize: 12 }}>
              No dependencies configured
            </div>
          ) : (
            <svg width="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ display: "block" }}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
                  <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-ghost)" opacity="0.5" />
                </marker>
              </defs>

              {/* Edges */}
              {deps.map((d, i) => {
                const fromPos = nodePositions.get(d.from);
                const toPos = nodePositions.get(d.to);
                if (!fromPos || !toPos) return null;

                const fromDown = statusMap.get(d.to) && !statusMap.get(d.to)!.up;
                const highlighted = hoveredNode === d.from || hoveredNode === d.to;
                const dimmed = hoveredNode && !highlighted;

                return (
                  <g key={`edge-${i}`}>
                    <line
                      x1={fromPos.x} y1={fromPos.y + 22}
                      x2={toPos.x} y2={toPos.y - 22}
                      stroke={fromDown ? "var(--critical)" : "var(--border-mid)"}
                      strokeWidth={highlighted ? 2 : 1}
                      opacity={dimmed ? 0.15 : 0.6}
                      markerEnd="url(#arrow)"
                      strokeDasharray={fromDown ? "4 3" : "none"}
                      style={{ transition: "opacity 0.2s" }}
                    />
                    {d.label && highlighted && (
                      <text
                        x={(fromPos.x + toPos.x) / 2 + 8}
                        y={(fromPos.y + toPos.y) / 2}
                        style={{ fontSize: 8, fill: "var(--text-ghost)", fontFamily: "monospace" }}
                      >
                        {d.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {nodes.map(name => {
                const pos = nodePositions.get(name);
                if (!pos) return null;
                const status = statusMap.get(name);
                const isUp = status ? status.up : true;
                const isConfigured = status ? status.configured : false;
                const color = getColor(name);
                const isHovered = hoveredNode === name;
                const isImpacted = impactedNodes.has(name);
                const dimmed = hoveredNode && !isHovered && !isImpacted && hoveredNode !== name;

                return (
                  <g
                    key={`node-${name}`}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    style={{ cursor: "pointer", opacity: dimmed ? 0.2 : 1, transition: "opacity 0.2s" }}
                    onMouseEnter={() => setHoveredNode(name)}
                    onMouseLeave={() => setHoveredNode(null)}
                  >
                    <circle
                      r={isHovered ? 24 : 20}
                      fill={isHovered ? color : "var(--surface)"}
                      stroke={isImpacted ? "var(--warn)" : color}
                      strokeWidth={isHovered ? 2.5 : 1.5}
                      strokeDasharray={isImpacted ? "4 2" : "none"}
                    />
                    {/* Status dot */}
                    <circle
                      r={4} cx={14} cy={-14}
                      fill={!isConfigured ? "var(--text-ghost)" : isUp ? "var(--ok)" : "var(--critical)"}
                      stroke="var(--card)" strokeWidth={2}
                    />
                    <text
                      textAnchor="middle" dominantBaseline="middle"
                      style={{
                        fontSize: 8, fontWeight: 700, textTransform: "uppercase",
                        fill: isHovered ? "var(--bg)" : color,
                        letterSpacing: "0.03em",
                      }}
                    >
                      {name.length > 8 ? name.slice(0, 7) + "..." : name}
                    </text>
                    <text
                      y={32} textAnchor="middle"
                      style={{ fontSize: 8, fill: "var(--text-ghost)", fontFamily: "monospace" }}
                    >
                      {!isConfigured ? "not configured" : isUp ? "online" : "DOWN"}
                    </text>
                    {isImpacted && (
                      <text y={42} textAnchor="middle" style={{ fontSize: 7, fill: "var(--warn)", fontWeight: 600 }}>
                        IMPACTED
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2" style={{ borderTop: "1px solid var(--border-dim)", fontSize: 9, color: "var(--text-ghost)" }}>
          <span>Hover a down service to see impact chain</span>
          <span>Arrows show &quot;depends on&quot; direction</span>
        </div>
      </div>
    </>
  );
}
