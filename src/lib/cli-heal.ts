// Pure core for the `testrify` CLI's local auto-heal of exported Playwright tests. No I/O — the
// CLI (cli/testrify.ts) does the running, Claude calls, and file writes; this module just parses
// Playwright's JSON report, extracts/validates locators, and rewrites locator calls in source.
// Kept in src/ so root vitest + tsc cover it. This logic WRITES to a user's source file, so it
// errs toward leaving the file untouched whenever anything looks off.

export type SpecFailure = {
  file: string; // the test file that failed
  title: string; // the failing test's title
  locator: string | null; // the locator call extracted from the error, if any
  message: string; // the raw error message
};

const CONSTRUCT = /(?:getBy[A-Za-z]+|locator)\(/g;

// From an opening "getByX(" / "locator(" at `start`, return the FULL balanced call — tracking
// quotes and nested parens so a locator argument containing ")" (e.g. getByText('Save (draft)'))
// isn't truncated. Returns null if the call doesn't close on its line (don't risk a bad rewrite).
function balancedCall(s: string, start: number, openParen: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParen; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") i++; // skip escaped char
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      if (--depth === 0) return s.slice(start, i + 1);
    } else if (c === "\n") return null; // unterminated on this line → bail
  }
  return null;
}

function firstConstructFrom(s: string, from: number): string | null {
  CONSTRUCT.lastIndex = Math.max(0, from);
  const m = CONSTRUCT.exec(s);
  if (!m) return null;
  return balancedCall(s, m.index, m.index + m[0].length - 1);
}

// Extract the locator call from a Playwright error message. Prefers the construct right after the
// usual markers ("waiting for …", "Locator: …"); otherwise the first one anywhere.
export function locatorFromError(message: string): string | null {
  if (!message) return null;
  for (const re of [/waiting for\s+/, /Locator:\s*/]) {
    const mm = message.match(re);
    if (mm && mm.index != null) {
      const hit = firstConstructFrom(message, mm.index + mm[0].length);
      if (hit) return hit;
    }
  }
  return firstConstructFrom(message, 0);
}

// True if `expr` looks like a single, safe Playwright locator expression (so we never splice a
// malformed/garbage model response into a user's source file).
export function isPlausibleLocator(expr: string): boolean {
  if (!expr || /[\n;]/.test(expr)) return false;
  if (!/^(?:getBy[A-Za-z]+|locator)\(/.test(expr)) return false;
  // Parens must balance (respecting quotes) and the whole string must BE the call.
  return balancedCall(expr, 0, expr.indexOf("(")) === expr;
}

// Walk a Playwright JSON report (`--reporter=json`) and collect every failed/timed-out result,
// pulling the locator out of each error. Suites nest and a spec inherits its suite's file.
export function parsePlaywrightFailures(report: any): SpecFailure[] {
  const out: SpecFailure[] = [];
  const walk = (suite: any, inheritedFile: string) => {
    const file = suite?.file || inheritedFile || "";
    for (const spec of suite?.specs ?? []) {
      const specFile = spec?.file || file;
      const title = String(spec?.title ?? "");
      for (const t of spec?.tests ?? []) {
        for (const r of t?.results ?? []) {
          if (r?.status !== "failed" && r?.status !== "timedOut") continue;
          const errors = [...(Array.isArray(r.errors) ? r.errors : []), ...(r.error ? [r.error] : [])];
          for (const e of errors) {
            const message = String(e?.message ?? "");
            if (!message) continue;
            out.push({ file: specFile, title, locator: locatorFromError(message), message });
          }
        }
      }
    }
    for (const s of suite?.suites ?? []) walk(s, file);
  };
  for (const s of report?.suites ?? []) walk(s, "");
  return out;
}

// The page URL to inspect when healing a locator (slice 3b): the last `page.goto('url')` BEFORE
// the locator's first use in the source. Only a literal http(s) URL is returned — a goto built
// from process.env / a template can't be resolved here, so we fall back to a blind heal.
export function pageUrlForLocator(source: string, locatorCall: string): string | null {
  const at = locatorCall ? source.indexOf("." + locatorCall) : -1;
  const scope = at >= 0 ? source.slice(0, at) : source;
  const gotos = [...scope.matchAll(/\bgoto\(\s*(['"`])([^'"`]*)\1/g)];
  if (!gotos.length) return null;
  const url = gotos[gotos.length - 1][2];
  return /^https?:\/\//i.test(url) ? url : null;
}

// Replace a locator call in source — only where it appears as a `.<call>` member access (as the
// exported code always emits `page.getBy…`/`page.locator(…)`), so a bare occurrence in a comment
// or string isn't touched. Returns the new source + replacement count (0 → leave the file as-is).
export function rewriteLocatorCall(
  source: string,
  oldCall: string,
  newCall: string,
): { source: string; count: number } {
  const needle = "." + oldCall;
  if (!oldCall || oldCall === newCall || !source.includes(needle)) {
    return { source, count: 0 };
  }
  const count = source.split(needle).length - 1;
  return { source: source.split(needle).join("." + newCall), count };
}
