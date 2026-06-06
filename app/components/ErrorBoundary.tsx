"use client";

import { Component, type ReactNode } from "react";

// Reusable React error boundary for wrapping independent dashboard panels.
// The whole UI is one big client component, so without this a render error in
// any single panel (a malformed Grafana URL, an unexpected upstream payload
// shape) would unmount the entire dashboard. Wrapping each self-contained panel
// keeps a single failure local: the rest of the dashboard stays live and the
// broken panel shows a small, retryable fallback instead of a blank screen.

interface Props {
  children: ReactNode;
  // Human label shown in the fallback, e.g. "Grafana panel". Also logged.
  name?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Surface for debugging; the boundary stops it from bubbling further.
    console.error(`[ErrorBoundary${this.props.name ? ` · ${this.props.name}` : ""}]`, error);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          background: "var(--card)",
          border: "1px solid rgba(239,68,68,0.25)",
          borderRadius: 14,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {this.props.name ? `${this.props.name} couldn’t render.` : "This section couldn’t render."}
          {" "}The rest of the dashboard is unaffected.
        </span>
        <button
          onClick={this.reset}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.25)",
            color: "var(--critical)",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}
