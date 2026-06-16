// Deterministic parser: turns a recorded Playwright script into structured Testrify
// steps with canonical Locators. Playwright codegen already prefers
// getByRole/getByTestId/getByLabel, so the well-formed majority parses with no LLM.
// Only leftover css/xpath locators are flagged "brittle" for an LLM hardening pass.
// See docs/codegen-reliable-selectors.md.
import type { Locator } from "@/lib/locator";

export type ParsedStep = {
  action: string; // goto | click | fill | expect_visible | expect_text | expect_value | expect_count | expect_url_contains
  locator?: Locator;
  target?: string; // goto URL or expect_url_contains substring
  value?: string;
};

export type ParseResult = {
  steps: ParsedStep[];
  brittle: number[]; // indices of steps whose locator is css/xpath
  unparsed: string[]; // source lines we could not map (transparency)
};

// First quoted string ('...' or "...") captured by `re` (group 2 holds the value).
function firstString(re: RegExp, s: string): string | null {
  const m = s.match(re);
  return m ? m[2] : null;
}

const LOCATOR_MARKERS = [
  "getByTestId(",
  "getByRole(",
  "getByLabel(",
  "getByPlaceholder(",
  "getByText(",
  "locator(",
];

// Reduces a regex source to its longest literal run (drops metacharacters), so a
// `getByRole('button', { name: /Save.*/i })` becomes a usable substring name "Save"
// instead of the literal string "Save.*" that would never match.
function regexToLiteral(src: string): string {
  const parts = src
    .replace(/[.*+?^${}()|[\]\\]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.sort((a, b) => b.length - a.length)[0] || src;
}

// Extracts a locator from an expression. For chained locators
// (row.getByRole(...).getByRole(...)), binds to the LAST call — the actual target.
export function extractLocator(expr: string): Locator | null {
  let lastIdx = -1;
  for (const m of LOCATOR_MARKERS) {
    const i = expr.lastIndexOf(m);
    if (i > lastIdx) lastIdx = i;
  }
  const scope = lastIdx >= 0 ? expr.slice(lastIdx) : expr;

  const testid = firstString(/getByTestId\(\s*(['"])(.*?)\1/, scope);
  if (testid != null) return { by: "testid", value: testid };

  const roleMatch = scope.match(/getByRole\(\s*(['"])(.*?)\1\s*(?:,\s*\{([^}]*)\})?\s*\)/);
  if (roleMatch) {
    const role = roleMatch[2];
    const opts = roleMatch[3] || "";
    const strName = firstString(/name:\s*(['"])(.*?)\1/, opts);
    const reName = opts.match(/name:\s*\/(.*?)\/[a-z]*/)?.[1];
    const name = strName ?? (reName != null ? regexToLiteral(reName) : null);
    return name ? { by: "role", role, name } : { by: "role", role };
  }

  const label = firstString(/getByLabel\(\s*(['"])(.*?)\1/, scope);
  if (label != null) return { by: "label", value: label };

  const placeholder = firstString(/getByPlaceholder\(\s*(['"])(.*?)\1/, scope);
  if (placeholder != null) return { by: "placeholder", value: placeholder };

  const text = firstString(/getByText\(\s*(['"])(.*?)\1/, scope);
  if (text != null) return { by: "text", value: text };

  const sel = firstString(/locator\(\s*(['"])(.*?)\1/, scope);
  if (sel != null) {
    if (sel.startsWith("xpath=")) return { by: "xpath", value: sel.slice("xpath=".length) };
    if (sel.startsWith("//")) return { by: "xpath", value: sel };
    return { by: "css", value: sel };
  }
  return null;
}

export function parseCodegen(script: string): ParseResult {
  const steps: ParsedStep[] = [];
  const brittle: number[] = [];
  const unparsed: string[] = [];

  const lines = script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"));

  for (const raw of lines) {
    // Strip leading `await ` and a trailing semicolon.
    const line = raw.replace(/^await\s+/, "").replace(/;\s*$/, "");

    // Navigation.
    const goto = firstString(/page\.goto\(\s*(['"])(.*?)\1/, line);
    if (goto != null) {
      steps.push({ action: "goto", target: goto });
      continue;
    }

    // Assertions: expect(...).matcher(...)
    if (/^expect\(/.test(line)) {
      const url = firstString(/toHaveURL\(\s*(['"])(.*?)\1/, line);
      if (url != null) {
        steps.push({ action: "expect_url_contains", target: url });
        continue;
      }
      const loc = extractLocator(line);
      if (!loc) {
        unparsed.push(raw);
        continue;
      }
      let step: ParsedStep | null = null;
      if (/\.toBeVisible\(/.test(line)) step = { action: "expect_visible", locator: loc };
      else {
        const v =
          firstString(/\.toHaveValue\(\s*(['"])(.*?)\1/, line) != null
            ? {
                action: "expect_value",
                value: firstString(/\.toHaveValue\(\s*(['"])(.*?)\1/, line)!,
              }
            : firstString(/\.(?:toContainText|toHaveText)\(\s*(['"])(.*?)\1/, line) != null
              ? {
                  action: "expect_text",
                  value: firstString(/\.(?:toContainText|toHaveText)\(\s*(['"])(.*?)\1/, line)!,
                }
              : null;
        const count = line.match(/\.toHaveCount\(\s*(\d+)/);
        if (v) step = { action: v.action, locator: loc, value: v.value };
        else if (count) step = { action: "expect_count", locator: loc, value: count[1] };
      }
      if (!step) {
        unparsed.push(raw);
        continue;
      }
      pushStep(step);
      continue;
    }

    // Actions on a locator.
    const loc = extractLocator(line);
    if (loc) {
      const fillVal = firstString(/\.fill\(\s*(['"])(.*?)\1/, line);
      if (fillVal != null) {
        pushStep({ action: "fill", locator: loc, value: fillVal });
        continue;
      }
      if (/\.click\(/.test(line) || /\.check\(/.test(line) || /\.dblclick\(/.test(line)) {
        pushStep({ action: "click", locator: loc });
        continue;
      }
      // Recognized locator but an action the engine doesn't support (press, selectOption, …).
      unparsed.push(raw);
      continue;
    }

    unparsed.push(raw);
  }

  function pushStep(step: ParsedStep) {
    if (step.locator && (step.locator.by === "css" || step.locator.by === "xpath")) {
      brittle.push(steps.length);
    }
    steps.push(step);
  }

  return { steps, brittle, unparsed };
}
