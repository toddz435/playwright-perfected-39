// Variable interpolation for test specs. {{name}} placeholders in step locators/values,
// URLs, and API request fields are replaced with the test's variables at run time.
// Unknown variables are left untouched (so an unset {{var}} is visible, not silently blank).
export type Vars = Record<string, string>;

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function interpolate<T>(value: T, vars: Vars): T {
  if (typeof value === "string") {
    // hasOwnProperty (not `k in vars`) so {{constructor}}/{{toString}}/etc. don't resolve
    // to inherited Object.prototype members — unknown vars stay untouched.
    return value.replace(TOKEN, (m, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m,
    ) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolate(v, vars)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "__proto__") continue; // never let a data key corrupt the result's prototype
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

export const SECRET_MASK = "••••••";

// Note: secret values are encrypted at rest. The DECRYPTED values to mask come from
// secrets.server.ts `decryptedSecretValues()` (server-only, needs the key).

// Deep-replaces any occurrence of a secret value with the mask, so substituted secrets
// never end up stored in run records. Uses split/join (no regex escaping needed).
export function maskSecrets<T>(value: T, secrets: string[]): T {
  // Skip whitespace-only values (masking those is pure corruption, no security value), and
  // mask longest-first so a secret that is a prefix of another can't leave a partial tail.
  const list = [...new Set(secrets.filter((s) => s.trim().length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  if (!list.length) return value;
  if (typeof value === "string") {
    let out: string = value;
    for (const s of list) out = out.split(s).join(SECRET_MASK);
    return out as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => maskSecrets(v, list)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "__proto__") continue;
      out[k] = maskSecrets(v, list);
    }
    return out as unknown as T;
  }
  return value;
}
