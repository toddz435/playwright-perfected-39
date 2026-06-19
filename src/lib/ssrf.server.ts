// Server-only SSRF guard for user-supplied URLs the server (or a spawned browser) will fetch.
// Validates the scheme and resolves the host, refusing private/internal addresses so a
// recorded/run URL can't be pointed at cloud metadata (169.254.169.254), localhost, or the
// internal network. Recording your OWN localhost app is a legitimate LOCAL use, so the
// private-host block is opt-out via `allowPrivate` (set on a trusted local machine).
//
// Residual risk: DNS rebinding — a host can pass this check then resolve to a private IP at
// fetch time. Full protection needs pinning the resolved IP through to the fetch, which isn't
// feasible when we hand the URL to `playwright codegen`. Resolve-and-check is the standard
// first-pass mitigation.
import { lookup } from "node:dns/promises";

// Classifies an IP literal as private/internal (loopback, RFC1918, link-local incl. cloud
// metadata, CGNAT, IPv6 ULA/link-local, unspecified). Pure + unit-tested. A malformed input
// is treated as unsafe (returns true) so it can't slip past as "public".
export function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254) — classify the embedded IPv4.
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];

  if (ip.includes(".")) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
      return true; // malformed → unsafe
    const [a, b] = parts;
    if (a === 0) return true; // "this host" 0.0.0.0/8
    if (a === 10) return true; // private 10/8
    if (a === 127) return true; // loopback 127/8
    if (a === 169 && b === 254) return true; // link-local 169.254/16 (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
    if (a === 192 && b === 168) return true; // private 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }

  const v = ip.toLowerCase().replace(/%.*$/, ""); // strip any zone id
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  if (v.startsWith("fe80")) return true; // link-local fe80::/10
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // ULA fc00::/7
  if (!v.includes(":")) return true; // not a recognizable v4 or v6 literal → unsafe
  return false;
}

// Validates a user-supplied URL for fetching: http(s) only, and (unless allowPrivate) every
// resolved address must be public. Throws an Error with a user-safe message when it should be
// refused.
export async function assertPublicUrl(rawUrl: string, allowPrivate: boolean): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new Error("Only http(s) URLs are allowed.");
  if (allowPrivate) return; // trusted local machine — recording localhost/private is intentional

  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve host "${host}".`);
  }
  if (!addresses.length) throw new Error(`Could not resolve host "${host}".`);
  for (const { address } of addresses) {
    if (isPrivateIp(address))
      throw new Error(`Refusing a private/internal address (${host} → ${address}).`);
  }
}
