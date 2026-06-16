// Shared DOM redaction used before any page HTML is sent to an external LLM (the heal
// and hardening passes). Neutralizes user-entered values while preserving the structure,
// labels, roles, and placeholders the model needs. Single source of truth so a privacy
// fix can't be applied to one path and missed on the other.

// Neutralizes `value=` on ANY element, quoted OR unquoted. The leading whitespace in the
// pattern avoids matching attributes like `data-value=` (preceded by `-`, not space).
export function redactValues(html: string): string {
  return html.replace(/(\svalue=)("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1"[redacted]"');
}

// Full-document redaction: drop <script>/<style> bodies, neutralize values and textarea
// contents. Used by the AI selector healer.
export function redactHtml(html: string): string {
  return redactValues(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script></script>")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style></style>")
      .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, "$1[redacted]$2"),
  );
}

// Single-element snippet redaction: neutralize values, collapse whitespace, truncate.
export function redactSnippet(html: string, max = 240): string {
  return redactValues(html).replace(/\s+/g, " ").trim().slice(0, max);
}
