"use client";

import type { ClientConfig, Metrics, ServiceResult } from "@/app/lib/types";
import { SVC_LABELS, SVC_PORTS } from "@/app/lib/constants";
import { healthIssues } from "@/app/lib/alerts";
import { fmtDuration, fmtSmoothAgo } from "@/app/lib/formatters";
import { IncidentStrip, type IncidentFeed } from "@/app/components/IncidentStrip";

// ── Status summary ──────────────────────────────────────────────────────────
// The first thing on the dashboard: either "All systems normal" or a short
// list of what needs attention. It replaces the old one-line WARNING banner
// and the separate scrape-target banner, so the answer to "is anything wrong?"
// is in one place instead of being spread across coloured cards.
//
// Several services with the same problem (say, three *arr apps reporting a
// health error) share one row rather than three.
//
// Below it, the collector's incident log: "last incident 10 h ago: Radarr
// unreachable for 12 min" when all is well, and a 24-hour strip — so a problem
// that came and went overnight is still visible in the morning.

type Level = "warning" | "critical";

interface Issue {
  key:     string;
  level:   Level;
  status:  string;       // short word in the status colour: "Down", "Health error"
  subject: string;       // what it's about: "Radarr, Sonarr"
  detail?: string;       // muted explanation
  title?:  string;       // hover text, e.g. the apps' own health messages
  href?:   string;       // where to go to fix it
  action?: string;       // link text
}

const label = (name: string) => SVC_LABELS[name] ?? name;
const joinNames = (xs: ServiceResult[]) => xs.map(s => label(s.name)).join(", ");

function serviceUrl(name: string, cfg: ClientConfig | null): string | undefined {
  if (cfg?.serviceUrls?.[name]) return cfg.serviceUrls[name];
  const port = SVC_PORTS[name];
  return port && cfg?.truenasIp ? `http://${cfg.truenasIp}:${port}` : undefined;
}

// Exported for tests.
export function collectIssues(metrics: Metrics | null, services: ServiceResult[] | null, cfg: ClientConfig | null, demoMode: boolean): Issue[] {
  const issues: Issue[] = [];

  for (const h of healthIssues(metrics)) {
    issues.push({
      key: `metric-${h.msg}`, level: h.level,
      status: h.level === "critical" ? "Critical" : "Warning",
      subject: h.label, detail: h.value,
    });
  }

  if (!demoMode && metrics?.scrapeDegraded && metrics.scrapeTargets) {
    const down = metrics.scrapeTargets.filter(t => !t.up);
    if (down.length > 0) {
      issues.push({
        key: "scrape", level: "warning",
        status: down.length === 1 ? "Exporter down" : "Exporters down",
        subject: down.map(t => t.job).join(", "),
        detail: `Cards fed by ${down.length === 1 ? "it" : "them"} stay blank until ${down.length === 1 ? "it is" : "they are"} back. Try docker start <exporter> on the host.`,
      });
    }
  }

  const live = (services ?? []).filter(s => s.configured !== false);

  for (const s of live.filter(s => !s.up)) {
    const url = serviceUrl(s.name, cfg);
    issues.push({
      key: `down-${s.name}`, level: "critical", status: "Down", subject: label(s.name),
      detail: url ? `Can't reach ${url.replace(/^https?:\/\//, "")}. Is the container running?` : "Can't reach it.",
      href: url, action: "Open",
    });
  }

  for (const s of live.filter(s => s.up && s.authError)) {
    issues.push({
      key: `auth-${s.name}`, level: "critical", status: "Auth failed", subject: label(s.name),
      detail: "Reachable, but the saved credentials were rejected (401/403).",
      href: "/setup", action: "Fix in Setup",
    });
  }

  const healthGroup = (kind: "error" | "warning") => live.filter(s => s.up && !s.authError && (s.health?.[kind] ?? 0) > 0);
  for (const [kind, level, status] of [["error", "critical", "Health error"], ["warning", "warning", "Health warning"]] as const) {
    const group = healthGroup(kind);
    if (group.length === 0) continue;
    const messages = group.flatMap(s => (s.health?.messages ?? []).map(m => `${label(s.name)}: ${m}`));
    issues.push({
      key: `health-${kind}`, level, status, subject: joinNames(group),
      detail: `${group.length === 1 ? "Reports" : "Each reports"} a problem under System › Status.`,
      title: messages.length > 0 ? messages.join("\n") : undefined,
      href: group.length === 1 ? serviceUrl(group[0].name, cfg) : undefined,
      action: group.length === 1 ? "Open" : undefined,
    });
  }

  const kuma = live.find(s => s.name === "uptimekuma" && s.up && (s.downCount ?? 0) > 0);
  if (kuma) {
    const n = kuma.downCount!;
    issues.push({
      key: "kuma", level: "warning", status: "Monitor down", subject: label("uptimekuma"),
      detail: `${n} monitor${n === 1 ? " is" : "s are"} down.`,
      href: serviceUrl("uptimekuma", cfg), action: "Open",
    });
  }

  const stale = live.filter(s => s.up && s.stale);
  if (stale.length > 0) {
    issues.push({
      key: "stale", level: "warning", status: "Stale", subject: joinNames(stale),
      detail: "Showing the last good data; the latest fetch failed.",
    });
  }

  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
}

export function StatusSummary({ metrics, services, servicesUpdatedAt, clientConfig, demoMode, incidents: feed }: {
  metrics: Metrics | null;
  services: ServiceResult[] | null;
  servicesUpdatedAt: number | null;
  clientConfig: ClientConfig | null;
  demoMode: boolean;
  incidents: IncidentFeed | null;
}) {
  // Nothing to say until there is data to say it about.
  if (!metrics && !services) return null;

  const issues = collectIssues(metrics, services, clientConfig, demoMode);
  const live = (services ?? []).filter(s => s.configured !== false);
  const upCount = live.filter(s => s.up).length;
  const checked = servicesUpdatedAt
    ? new Date(servicesUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const meta = [
    live.length > 0 ? `${upCount} of ${live.length} services up` : null,
    checked ? `checked ${checked}` : null,
  ].filter(Boolean).join(" · ");

  const worst: Level | null = issues.some(i => i.level === "critical") ? "critical" : issues.length > 0 ? "warning" : null;
  const dot = worst === "critical" ? "var(--critical)" : worst === "warning" ? "var(--warn)" : "var(--ok)";
  const headline = issues.length === 0 ? "All systems normal"
    : `${issues.length} ${issues.length === 1 ? "thing needs" : "things need"} attention`;

  const showStrip = !!feed?.enabled && feed.now != null;
  // Only while all is well — with live issues, those are what matter.
  const last = issues.length === 0 && feed?.last?.end != null && feed.now != null && feed.now - feed.last.end < 7 * 86_400_000
    ? feed.last : null;

  return (
    <section aria-label="Status" style={{
      background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
      padding: issues.length > 0 && !showStrip ? "14px 18px 6px" : "14px 18px",
      display: "flex", flexDirection: "column", gap: issues.length > 0 || showStrip ? 10 : 0,
    }}>
      <div className="flex flex-wrap items-baseline justify-between" style={{ columnGap: 12, rowGap: 4 }}>
        <div className="flex flex-wrap items-baseline" style={{ columnGap: 10, rowGap: 2, minWidth: 0 }}>
          <h2 className="flex items-center" style={{ margin: 0, gap: 10, fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: dot, flexShrink: 0 }} />
            {headline}
          </h2>
          {last && (
            <span style={{ fontSize: 13, color: "var(--text-label)" }}
              title={`${new Date(last.start).toLocaleString()} – ${new Date(last.end!).toLocaleTimeString()}`}>
              Last incident {fmtSmoothAgo(last.end)}: {last.title} for {fmtDuration(last.end! - last.start)}
            </span>
          )}
        </div>
        {meta && <span style={{ fontSize: 12, color: "var(--text-label)", fontVariantNumeric: "tabular-nums" }}>{meta}</span>}
      </div>
      {issues.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {issues.map(i => {
            const color = i.level === "critical" ? "var(--critical)" : "var(--warn)";
            const external = i.href?.startsWith("http");
            return (
              <li key={i.key} title={i.title} className="flex flex-wrap items-baseline"
                style={{ columnGap: 14, rowGap: 2, padding: "9px 0", borderTop: "1px solid var(--border-subtle)", fontSize: 13 }}>
                <span style={{ width: 104, flexShrink: 0, fontSize: 12, fontWeight: 600, color }}>{i.status}</span>
                <span style={{ fontWeight: 500, color: "var(--text)" }}>{i.subject}</span>
                {i.detail && <span style={{ flex: "1 1 220px", minWidth: 0, color: "var(--text-label)" }}>{i.detail}</span>}
                {i.href && i.action && (
                  <a href={i.href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    style={{ fontSize: 12, color: "var(--brand)", marginLeft: "auto", whiteSpace: "nowrap" }}>
                    {i.action}{external ? " ↗" : ""}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {showStrip && <IncidentStrip incidents={feed!.incidents ?? []} now={feed!.now!} />}
    </section>
  );
}
