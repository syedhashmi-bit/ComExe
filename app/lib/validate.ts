// Minimal input guards for the write routes (POST/PATCH to data/*.json). These
// routes persist client-supplied JSON to disk and, in the case of server
// entries, fetch the supplied URL server-side — so unvalidated input is both a
// file-corruption and an SSRF surface. No external schema lib: small guards keep
// the dependency footprint at zero.

// True only for a non-empty, length-bounded string.
export function isNonEmptyString(v: unknown, maxLen = 200): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= maxLen;
}

// True only for a parseable http/https URL string. Rejects other schemes
// (file:, gopher:, etc.) that would otherwise be fetchable server-side.
export function isHttpUrl(v: unknown, maxLen = 500): v is string {
  if (typeof v !== "string" || v.length > maxLen) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
