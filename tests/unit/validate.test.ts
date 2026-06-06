import { describe, it, expect } from "vitest";
import { isNonEmptyString, isHttpUrl } from "@/app/lib/validate";

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
