import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fmtBytes, fmtTemp, fmtUptime, fmtSmoothAgo, fmtSince, fmtPct,
  fmtEtaShort, cleanTitle, pct, barColor, normalizeSpeedResult,
} from "@/app/lib/formatters";

// 147 lines of pure functions used on every card, previously untested.
// Several encode decisions that caused real bugs — those are called out below.

afterEach(() => vi.useRealTimers());

describe("fmtBytes", () => {
  it("uses decimal units by default and binary on request", () => {
    expect(fmtBytes(1_000_000)).toBe("1.0 MB");
    expect(fmtBytes(1_048_576, 1, "binary")).toBe("1.0 MiB");
  });

  it("renders an em dash for null rather than 0 or NaN", () => {
    expect(fmtBytes(null)).toBe("—");
    expect(fmtBytes(NaN)).toBe("—");
  });

  it("handles zero and caps at the largest unit", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(5e15)).toContain("TB"); // clamps rather than running off the end
  });
});

describe("fmtTemp", () => {
  it("converts to Fahrenheit when asked", () => {
    expect(fmtTemp(0, "F")).toBe("32°F");
    expect(fmtTemp(100, "F")).toBe("212°F");
    expect(fmtTemp(42)).toBe("42°C");
  });
  it("passes null through", () => expect(fmtTemp(null)).toBe("—"));
});

describe("fmtUptime", () => {
  it("drops to the two most significant units", () => {
    expect(fmtUptime(90)).toBe("1m");
    expect(fmtUptime(3700)).toBe("1h 1m");
    expect(fmtUptime(90_000)).toBe("1d 1h");
  });
  it("passes null through", () => expect(fmtUptime(null)).toBe("—"));
});

describe("fmtSmoothAgo", () => {
  // Deliberately bucketed so the UI doesn't twitch 0s -> 1s -> 2s every tick.
  const NOW = 1_700_000_000_000;
  const at = (secAgo: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return fmtSmoothAgo(NOW - secAgo * 1000);
  };

  it("buckets by magnitude", () => {
    expect(at(2)).toBe("just now");
    expect(at(23)).toBe("25s ago");     // nearest 5s
    expect(at(200)).toBe("3m ago");     // nearest minute
    expect(at(7200)).toBe("2h ago");
    expect(at(172_800)).toBe("2d ago");
  });

  it("never renders a negative age from a clock skew", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(fmtSmoothAgo(NOW + 60_000)).toBe("just now");
  });

  it("passes null through", () => expect(fmtSmoothAgo(null)).toBe("—"));
});

describe("fmtEtaShort", () => {
  // qBittorrent reports 8640000s (~100 days) to mean "unknown". Rendering that
  // as "100d" would be a confident lie about a download that has no estimate.
  it("suppresses qBittorrent's 'unknown' sentinel", () => {
    expect(fmtEtaShort(8_640_000)).toBeNull();
    expect(fmtEtaShort(9_000_000)).toBeNull();
  });

  it("suppresses non-values rather than rendering them", () => {
    expect(fmtEtaShort(null)).toBeNull();
    expect(fmtEtaShort(undefined)).toBeNull();
    expect(fmtEtaShort(0)).toBeNull();
    expect(fmtEtaShort(-5)).toBeNull();
    expect(fmtEtaShort(Infinity)).toBeNull();
  });

  it("scales the unit to the magnitude", () => {
    expect(fmtEtaShort(45)).toBe("45s");
    expect(fmtEtaShort(600)).toBe("10m");
    expect(fmtEtaShort(7200)).toBe("2h");
    expect(fmtEtaShort(172_800)).toBe("2d");
  });
});

describe("cleanTitle", () => {
  it("strips release-tag noise from scene names", () => {
    expect(cleanTitle("Some.Movie.2024.1080p.BluRay.x264-GROUP")).toBe("Some Movie 2024");
    expect(cleanTitle("Another.Show.S01E02.2160p.WEB-DL.HEVC")).toBe("Another Show S01E02");
  });

  it("leaves an already-clean title alone", () => {
    expect(cleanTitle("The Bear")).toBe("The Bear");
  });
});

describe("pct", () => {
  it("clamps at 100 and never divides by zero", () => {
    expect(pct(50, 100)).toBe(50);
    expect(pct(150, 100)).toBe(100);
    expect(pct(1, 0)).toBe(0);
    expect(pct(null, 100)).toBe(0);
    expect(pct(50, null)).toBe(0);
  });
});

describe("barColor", () => {
  it("escalates at 75 and 90", () => {
    expect(barColor(10)).not.toBe("var(--warn)");
    expect(barColor(75)).toBe("var(--warn)");
    expect(barColor(90)).toBe("var(--critical)");
  });
});

describe("fmtPct", () => {
  it("keeps one decimal and passes null through", () => {
    expect(fmtPct(42.35)).toBe("42.4%");
    expect(fmtPct(null)).toBe("—");
  });
});

describe("fmtSince", () => {
  it("renders a date for a seconds-ago value", () => {
    // Format is locale-dependent; assert shape, not exact text.
    expect(fmtSince(3600)).toMatch(/\w+ \d+ · \d{2}:\d{2}/);
    expect(fmtSince(null)).toBe("—");
  });
});

describe("normalizeSpeedResult", () => {
  it("maps the upstream shape onto the client contract", () => {
    const r = normalizeSpeedResult({
      ping: 12, download: 100, upload: 20, jitter: 1,
      server_name: "Launceston", server_host: "host:8080",
      created_at: "2026-01-01T00:00:00Z", isp: "Launtel",
    });
    expect(r.ping).toBe(12);
    expect(r.download).toBe(100);
    expect(r.serverName).toBe("Launceston");
    expect(r.isp).toBe("Launtel");
  });

  it("tolerates a completely empty record", () => {
    const r = normalizeSpeedResult({});
    expect(r.download).toBeNull();
    expect(r.serverName).toBeNull();
  });
});
