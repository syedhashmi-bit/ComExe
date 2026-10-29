import { describe, it, expect } from "vitest";
import { trackIncidents, incidentKey, incidentTitle, MERGE_MS, RETAIN_MS, type IncidentLog } from "@/app/lib/incidents";
import type { AlertFire } from "@/app/lib/alert-events";

// The incident log is what lets the status line say "last incident 10 h ago:
// Radarr unreachable for 12 min". What matters: an incident opens once, closes
// when the problem clears, isn't closed by a tick that simply had no data, and
// a flapping service doesn't become a pile of separate incidents.

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const both = { metrics: true, services: true };

const fire = (key: string, level: AlertFire["level"] = "critical"): AlertFire =>
  ({ key, ts: T0, level, source: key.startsWith("service:") ? "service" : "metric", msg: key });
const empty = (): IncidentLog => ({ since: T0, incidents: [] });

describe("incidentKey / incidentTitle", () => {
  it("groups thresholds and health levels under one subject", () => {
    expect(incidentKey("cpu>80")).toBe("cpu");
    expect(incidentKey("cpu>95")).toBe("cpu");
    expect(incidentKey("disk:/mnt/Pool/Media/TV>85")).toBe("disk:/mnt/Pool/Media/TV");
    expect(incidentKey("service:radarr:error")).toBe("service:radarr:health");
    expect(incidentKey("service:radarr:warn")).toBe("service:radarr:health");
    expect(incidentKey("service:radarr:down")).toBe("service:radarr:down");
  });

  it("writes titles people can read", () => {
    expect(incidentTitle(fire("service:radarr:down"))).toBe("Radarr unreachable");
    expect(incidentTitle(fire("service:qbittorrent:warn"))).toBe("qBittorrent health check failing");
    expect(incidentTitle(fire("mem>93"))).toBe("High memory");
    expect(incidentTitle(fire("disk:/mnt/Pool/Media/TV>85"))).toBe("/mnt/Pool/Media/TV filling up");
  });
});

describe("trackIncidents", () => {
  it("opens an incident once and closes it when the problem clears", () => {
    let { log, changed } = trackIncidents(empty(), [fire("service:radarr:down")], both, T0);
    expect(changed).toBe(true);
    expect(log.incidents).toEqual([{ key: "service:radarr:down", level: "critical", title: "Radarr unreachable", start: T0, end: null }]);

    ({ log, changed } = trackIncidents(log, [fire("service:radarr:down")], both, T0 + MIN));
    expect(changed).toBe(false);

    ({ log, changed } = trackIncidents(log, [], both, T0 + 12 * MIN));
    expect(changed).toBe(true);
    expect(log.incidents[0].end).toBe(T0 + 12 * MIN);
  });

  it("doesn't close an incident on a tick with no data for its source", () => {
    const { log } = trackIncidents(empty(), [fire("cpu>95"), fire("service:sonarr:down")], both, T0);
    // Services answered (Sonarr is back), metrics didn't.
    const next = trackIncidents(log, [], { metrics: false, services: true }, T0 + MIN).log;
    const byKey = Object.fromEntries(next.incidents.map(i => [i.key, i.end]));
    expect(byKey).toEqual({ cpu: null, "service:sonarr:down": T0 + MIN });
  });

  it("records the worst level an incident reached", () => {
    let { log } = trackIncidents(empty(), [fire("cpu>80", "warning")], both, T0);
    ({ log } = trackIncidents(log, [fire("cpu>95", "critical")], both, T0 + MIN));
    ({ log } = trackIncidents(log, [fire("cpu>80", "warning")], both, T0 + 2 * MIN));
    expect(log.incidents).toHaveLength(1);
    expect(log.incidents[0].level).toBe("critical");
  });

  it("merges a problem that comes back within the merge window", () => {
    let { log } = trackIncidents(empty(), [fire("service:radarr:down")], both, T0);
    ({ log } = trackIncidents(log, [], both, T0 + MIN));
    ({ log } = trackIncidents(log, [fire("service:radarr:down")], both, T0 + MIN + MERGE_MS - 1));
    expect(log.incidents).toHaveLength(1);
    expect(log.incidents[0]).toMatchObject({ start: T0, end: null });

    ({ log } = trackIncidents(log, [], both, T0 + 10 * MIN));
    ({ log } = trackIncidents(log, [fire("service:radarr:down")], both, T0 + 10 * MIN + MERGE_MS + 1));
    expect(log.incidents).toHaveLength(2);
  });

  it("drops finished incidents older than the retention window", () => {
    const old = { key: "cpu", level: "warning" as const, title: "High CPU", start: T0 - RETAIN_MS - 2 * MIN, end: T0 - RETAIN_MS - MIN };
    const { log, changed } = trackIncidents({ since: T0 - RETAIN_MS * 2, incidents: [old] }, [], both, T0);
    expect(changed).toBe(true);
    expect(log.incidents).toEqual([]);
  });
});
