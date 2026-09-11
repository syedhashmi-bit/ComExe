import { describe, it, expect } from "vitest";
import { isNonEmptyString, isHttpUrl, isSameOrigin, isJsonContentType } from "@/app/lib/validate";

describe("isNonEmptyString", () => {
  it("accepts a normal string", () => {
    expect(isNonEmptyString("hello")).toBe(true);
  });

  it("rejects empty and whitespace-only strings", () => {
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString("\t\n")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isNonEmptyString(123)).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString({})).toBe(false);
    expect(isNonEmptyString(["a"])).toBe(false);
  });

  it("enforces the max length (default 200)", () => {
    expect(isNonEmptyString("a".repeat(200))).toBe(true);
    expect(isNonEmptyString("a".repeat(201))).toBe(false);
  });

  it("honors a custom max length", () => {
    expect(isNonEmptyString("abc", 3)).toBe(true);
    expect(isNonEmptyString("abcd", 3)).toBe(false);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpUrl("http://192.168.88.196:30104")).toBe(true);
    expect(isHttpUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("rejects non-http(s) schemes (SSRF surface)", () => {
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("gopher://evil")).toBe(false);
    expect(isHttpUrl("ftp://host/x")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects unparseable strings and non-strings", () => {
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl(123)).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
  });

  it("enforces the max length (default 500)", () => {
    expect(isHttpUrl("http://a.com/" + "x".repeat(600))).toBe(false);
  });
});

describe("isSameOrigin", () => {
  const GRAFANA = "http://192.168.88.196:30037";

  it("accepts any path/query on the configured origin", () => {
    expect(isSameOrigin(`${GRAFANA}/d-solo/abc/node-exporter?panelId=77`, GRAFANA)).toBe(true);
    expect(isSameOrigin(`${GRAFANA}/`, GRAFANA)).toBe(true);
  });

  // The exfiltration case: /api/grafana/render attaches GRAFANA_API_TOKEN to
  // whatever this returns true for.
  it("rejects a different host, port or scheme", () => {
    expect(isSameOrigin("http://evil.example/d/x", GRAFANA)).toBe(false);
    expect(isSameOrigin("http://192.168.88.196:9999/d/x", GRAFANA)).toBe(false);
    expect(isSameOrigin("https://192.168.88.196:30037/d/x", GRAFANA)).toBe(false);
  });

  // http://evil/d/x satisfies the /d/<uid> regex in grafana/test, which is why
  // that regex was never a security check.
  it("rejects a hostile URL that still matches the dashboard-UID shape", () => {
    expect(isSameOrigin("http://attacker.test/d/rYdddlPWk/anything", GRAFANA)).toBe(false);
  });

  it("rejects unparseable input and non-strings", () => {
    expect(isSameOrigin("not a url", GRAFANA)).toBe(false);
    expect(isSameOrigin(null, GRAFANA)).toBe(false);
    expect(isSameOrigin(`${GRAFANA}/x`, "not a url")).toBe(false);
  });
});

describe("isJsonContentType", () => {
  const withCT = (ct?: string) =>
    new Request("http://x/api/config", { method: "POST", body: "{}", ...(ct ? { headers: { "content-type": ct } } : {}) });

  it("accepts application/json, with or without parameters", () => {
    expect(isJsonContentType(withCT("application/json"))).toBe(true);
    expect(isJsonContentType(withCT("application/json; charset=utf-8"))).toBe(true);
    expect(isJsonContentType(withCT("APPLICATION/JSON"))).toBe(true);
  });

  // These three are CORS "simple request" types — they are exactly what a
  // cross-origin page can send with no preflight, so they must be refused.
  it("rejects the CSRF-capable simple-request content types", () => {
    expect(isJsonContentType(withCT("text/plain"))).toBe(false);
    expect(isJsonContentType(withCT("application/x-www-form-urlencoded"))).toBe(false);
    expect(isJsonContentType(withCT("multipart/form-data"))).toBe(false);
  });

  it("rejects a missing Content-Type", () => {
    expect(isJsonContentType(new Request("http://x/api/config", { method: "POST" }))).toBe(false);
  });
});
