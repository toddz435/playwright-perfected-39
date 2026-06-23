// Detecting + redacting sensitive recorded values.
//
// Playwright Codegen captures whatever you TYPE — including passwords — as literal fill() values.
// We never want a raw password persisted in a test's spec. This module (a) flags fields whose
// name/label looks sensitive and (b) rewrites those recorded fills to {{secret}} variable
// references WITHOUT keeping the literal, so the user sets the real value as an encrypted secret
// in the app. Pure + unit-tested; shared by the CLI recorder, the variables editor, and the
// data-drive wizard (one source of truth for the heuristic).
import { locatorLabel, type Locator } from "@/lib/locator";
import { normalizeColumn, uniquifyColumns } from "@/lib/dataset";

// Field names/labels that indicate a secret the user shouldn't store in plaintext.
export const SENSITIVE_RE = /pass|secret|token|api.?key|otp|cvv|ssn|credit|card|\bpin\b/i;

type FillStep = { action: string; locator?: Locator; target?: string; value?: string };

// True when the step types a value into a field whose name/label looks sensitive.
export function isSensitiveFill(step: FillStep): boolean {
  if (step.action !== "fill" || !step.value) return false;
  return SENSITIVE_RE.test(locatorLabel(step.locator));
}

// Rewrite recorded sensitive fills to {{name}} references and DROP the literal value, returning the
// new steps plus the secret variable names to register (empty-valued, flagged secret) so the user
// fills them securely in the app. Names are derived from each field and de-duplicated. Pure.
export function redactSensitiveFills<T extends FillStep>(steps: T[]): {
  steps: T[];
  secretNames: string[];
} {
  const sensitiveIdx = steps.map((s, i) => (isSensitiveFill(s) ? i : -1)).filter((i) => i >= 0);
  if (sensitiveIdx.length === 0) return { steps, secretNames: [] };

  // Derive a readable var name per sensitive field (e.g. "password"), then uniquify across them.
  // Guard reserved/invalid names (the CLI/recorder insert directly, bypassing the editor's
  // isValidVarName + RESERVED_VAR_NAMES check) so we never emit e.g. {{constructor}}.
  const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
  const safe = (n: string) => (RESERVED.has(n) || !/^[\w.-]+$/.test(n) ? "secret" : n);
  const names = uniquifyColumns(
    sensitiveIdx.map((i, k) => safe(normalizeColumn(varNameForStep(steps[i]), k))),
  );
  const nameByIdx = new Map<number, string>();
  sensitiveIdx.forEach((i, k) => nameByIdx.set(i, names[k]));

  const out = steps.map((s, i) =>
    nameByIdx.has(i) ? ({ ...s, value: `{{${nameByIdx.get(i)}}}` } as T) : s,
  );
  return { steps: out, secretNames: names };
}

// A base name from the field's locator (role name / label / placeholder / value), else "secret".
function varNameForStep(step: FillStep): string {
  const loc = step.locator;
  if (loc) {
    if (loc.by === "role" && loc.role === "textbox" && loc.name) return loc.name;
    if (loc.by === "label" || loc.by === "placeholder" || loc.by === "testid") return loc.value;
    if (loc.by === "role" && loc.name) return loc.name;
  }
  return "secret";
}
