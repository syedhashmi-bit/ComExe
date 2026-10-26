// ── DNS-rebinding guard ─────────────────────────────────────────────────────
// With auth off (the default), a web page you visit can point its own domain
// at the dashboard's LAN IP once its script has loaded. The browser then treats
// http://evil.example:3000 as same-origin with that page, so the script can
// read GET /api/backup — every saved credential in plaintext — and write
// POST /api/config. Not hosting on a domain doesn't help: the attacker brings
// the domain, and your browser is the bridge into the LAN.
//
// That only ever works through a hostname the attacker controls, so proxy.ts
// refuses any Host that isn't one of:
//   - an IP literal (192.168.88.196:3000, [::1]:3000)
//   - localhost, or a single-label name (truenas) — no public DNS answers those
//   - a name under a suffix public DNS doesn't serve (.local, .lan, …)
//   - an exact name listed in COMEXE_ALLOWED_HOSTS (comma-separated), e.g. a
//     reverse-proxy domain like dashboard.example.com
//
// Dependency-free so proxy.ts can import it (same reason as session-token.ts).

const LOCAL_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal", ".localhost"];

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** `host` is the raw Host header value, port included. */
export function isAllowedHost(host: string, allowList = ""): boolean {
  const name = host.trim().toLowerCase().replace(/:\d+$/, "");
  if (!name) return false;
  if (IPV4.test(name) || name.startsWith("[")) return true;
  if (!name.includes(".")) return true;
  if (LOCAL_SUFFIXES.some(s => name.endsWith(s))) return true;
  return allowList
    .split(",")
    .map(s => s.trim().toLowerCase().replace(/:\d+$/, ""))
    .some(s => s !== "" && s === name);
}
