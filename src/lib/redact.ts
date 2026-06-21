// Shared DOM redaction used before any page HTML is sent to an external LLM (the heal
// and hardening passes). Neutralizes user-entered values while preserving the structure,
// labels, roles, and placeholders the model needs. Single source of truth so a privacy
// fix can't be applied to one path and missed on the other.

// Neutralizes `value=` on ANY element, quoted OR unquoted. The leading whitespace in the
// pattern avoids matching attributes like `data-value=` (preceded by `-`, not space).
export function redactValues(html: string): string {
  return html.replace(/(\svalue=)("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1"[redacted]"');
}

// Strips the query string + fragment from href/src (where session tokens and one-time links
// commonly hide) and empties inline data: payloads — keeping the PATH so structural/link locators
// still resolve. Leading whitespace (like redactValues) avoids matching data-src/etc. by accident.
export function redactUrls(html: string): string {
  return html.replace(/(\s(?:href|src)=)("[^"]*"|'[^']*'|[^\s>]+)/gi, (_m, attr, raw) => {
    const quoted = raw[0] === '"' || raw[0] === "'";
    const q = quoted ? raw[0] : '"';
    const url = quoted ? raw.slice(1, -1) : raw;
    const cleaned = /^\s*data:/i.test(url) ? "data:[redacted]" : url.replace(/[?#][\s\S]*$/, "");
    return `${attr}${q}${cleaned}${q}`;
  });
}

// Full-document redaction: drop <script>/<style> bodies, neutralize input values and textarea
// contents, and strip tokens from href/src. Used by the AI selector healer/hardener. NOTE: visible
// TEXT content is intentionally preserved — the model needs it to suggest text/role locators — so a
// page that RENDERS sensitive data as text will still include it.
export function redactHtml(html: string): string {
  return redactValues(
    redactUrls(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script></script>")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style></style>")
        .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, "$1[redacted]$2"),
    ),
  );
}

// Single-element snippet redaction: neutralize values, collapse whitespace, truncate.
export function redactSnippet(html: string, max = 240): string {
  return redactValues(html).replace(/\s+/g, " ").trim().slice(0, max);
}
