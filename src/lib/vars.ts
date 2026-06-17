// Variable interpolation for test specs. {{name}} placeholders in step locators/values,
// URLs, and API request fields are replaced with the test's variables at run time.
// Unknown variables are left untouched (so an unset {{var}} is visible, not silently blank).
export type Vars = Record<string, string>;

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function interpolate<T>(value: T, vars: Vars): T {
  if (typeof value === "string") {
    return value.replace(TOKEN, (m, k) => (k in vars ? String(vars[k]) : m)) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolate(v, vars)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolate(v, vars);
    }
    return out as unknown as T;
  }
  return value;
}

// Normalizes a spec's `variables` field (may be missing/malformed) to a plain string map.
export function specVars(spec: any): Vars {
  const v = spec?.variables;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Vars = {};
  for (const [k, val] of Object.entries(v)) out[k] = String(val ?? "");
  return out;
}
