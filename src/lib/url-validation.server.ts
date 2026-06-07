// Validates that a URL is safe to fetch (blocks SSRF attacks).
// Rejects private/internal IPs, non-http(s) schemes, and link-local addresses.

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata.google"]);

const PRIVATE_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // link-local / cloud metadata
  /^0\./, // 0.0.0.0/8
  /^::1$/, // IPv6 loopback
  /^fd/, // IPv6 ULA
  /^fe80:/, // IPv6 link-local
  /^fc/, // IPv6 ULA
];

export function validateFetchUrl(url: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `Scheme '${parsed.protocol}' not allowed — only http(s)` };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `Hostname '${hostname}' is blocked` };
  }

  // Strip IPv6 brackets
  const bare = hostname.replace(/^\[/, "").replace(/]$/, "");
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(bare)) {
      return { ok: false, reason: "Requests to private/internal IP addresses are not allowed" };
    }
  }

  return { ok: true };
}
