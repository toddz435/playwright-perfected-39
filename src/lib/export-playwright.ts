// Exports a Testrify browser test to a clean, human-readable native Playwright `.spec.ts` file.
// The inverse of codegen-parse.ts: our step + locator model → Playwright API calls. Pure +
// client-safe (runs in the browser for the download).
//
// Variables: a {{name}} that's a known plain test variable is inlined as its value; anything else
// (a secret, a dataset column, or an unknown) becomes `process.env["name"]` so the exported test
// is parameterized and NO secret is ever baked into the code.
import { specVars } from "@/lib/vars";
import { isBlockMarker } from "@/lib/blocks";
import { conditionLabel } from "@/lib/conditions";

const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

// A TS string expression for a value, resolving {{tokens}}. Known plain vars are inlined; secrets/
// unknowns become `process.env[...]`. No tokens → a plain double-quoted string; otherwise a
// template literal (when any token resolves to env).
export function emitValue(raw: string, vars: Record<string, string>): string {
  const known = (n: string) => Object.prototype.hasOwnProperty.call(vars, n);
  const hasEnv = Array.from(raw.matchAll(TOKEN)).some((m) => !known(m[1]));
  if (!hasEnv) {
    return JSON.stringify(raw.replace(TOKEN, (_, n) => vars[n] ?? ""));
  }
  const esc = (s: string) => s.replace(/[\\`]/g, "\\$&").replace(/\$\{/g, "\\${");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(raw))) {
    out += esc(raw.slice(last, m.index));
    out += known(m[1])
      ? esc(vars[m[1]] ?? "")
      : `\${process.env[${JSON.stringify(m[1])}] ?? ""}`;
    last = m.index + m[0].length;
  }
  out += esc(raw.slice(last));
  return "`" + out + "`";
}

type Loc = { by: string; value?: string; role?: string; name?: string };

// A Playwright locator expression for a step (`page.getByRole(...)`, etc.). Falls back to
// `page.locator(target)` for a raw/legacy target string.
export function emitLocator(step: any): string {
  const loc: Loc | undefined = step?.locator;
  if (loc && typeof loc === "object") {
    switch (loc.by) {
      case "testid":
        return `page.getByTestId(${JSON.stringify(loc.value)})`;
      case "role":
        return `page.getByRole(${JSON.stringify(loc.role)}${
          loc.name ? `, { name: ${JSON.stringify(loc.name)} }` : ""
        })`;
      case "label":
        return `page.getByLabel(${JSON.stringify(loc.value)})`;
      case "placeholder":
        return `page.getByPlaceholder(${JSON.stringify(loc.value)})`;
      case "text":
        return `page.getByText(${JSON.stringify(loc.value)})`;
      case "xpath":
        return `page.locator(${JSON.stringify("xpath=" + loc.value)})`;
      case "css":
      default:
        return `page.locator(${JSON.stringify(loc.value)})`;
    }
  }
  return `page.locator(${JSON.stringify(step?.target ?? "")})`;
}

// One line of Playwright code for a step. Returns null for actions that don't map to a statement.
function emitStep(step: any, vars: Record<string, string>, shotIdx: { n: number }): string | null {
  const v = (raw: unknown) => emitValue(String(raw ?? ""), vars);
  switch (step.action) {
    case "goto":
      return `await page.goto(${v(step.target)});`;
    case "click":
      return `await ${emitLocator(step)}.click();`;
    case "fill":
      return `await ${emitLocator(step)}.fill(${v(step.value)});`;
    case "press":
      return `await ${emitLocator(step)}.press(${v(step.value)});`;
    case "screenshot": {
      const name = `screenshot-${++shotIdx.n}.png`;
      if (step.locator || (step.target && step.value !== "fullPage"))
        return `await ${emitLocator(step)}.screenshot({ path: ${JSON.stringify(name)} });`;
      const full = step.value === "fullPage" ? ", fullPage: true" : "";
      return `await page.screenshot({ path: ${JSON.stringify(name)}${full} });`;
    }
    case "expect_visible":
      return `await expect(${emitLocator(step)}).toBeVisible();`;
    case "expect_text":
      return `await expect(${emitLocator(step)}).toContainText(${v(step.value)});`;
    case "expect_value":
      return `await expect(${emitLocator(step)}).toHaveValue(${v(step.value)});`;
    case "expect_count":
      return `await expect(${emitLocator(step)}).toHaveCount(${Number(step.value) || 0});`;
    case "expect_url_contains":
      // expect.poll auto-waits (e.g. for a navigation to settle) while keeping exact-substring
      // semantics — no regex-metachar surprises a toHaveURL(/…/) would introduce.
      return `await expect.poll(() => page.url()).toContain(${v(step.target)});`;
    default:
      return null;
  }
}

// Comment line for a control-flow marker, preserving the test's structure in the export. (Full
// translation to if/for/while is a follow-up; the steps below currently run unconditionally.)
function emitMarkerComment(step: any): string {
  switch (step.action) {
    case "if":
      return `// if (${step.condition ? conditionLabel(step.condition) : "…"}) {`;
    case "else":
      return `// } else {`;
    case "endif":
      return `// }`;
    case "repeat":
      return `// repeat ${step.loop?.count ? `${step.loop.count}×` : step.condition ? `while ${conditionLabel(step.condition)}` : ""} {`;
    case "endrepeat":
      return `// }`;
    default:
      return `// ${step.action}`;
  }
}

// Builds the full `.spec.ts` source for a browser test.
export function exportToPlaywright(test: any): string {
  const steps: any[] = test?.spec?.steps || [];
  // specVars includes secret NAMES (with their encrypted blob values on the client). Strip them so
  // a secret token is NEVER inlined — it must fall through to the process.env branch instead.
  const vars: Record<string, string> = { ...specVars(test?.spec) };
  const secretNames: string[] = Array.isArray(test?.spec?.secrets) ? test.spec.secrets : [];
  for (const n of secretNames) delete vars[n];
  const title = JSON.stringify(String(test?.name || "exported test"));

  const body: string[] = [];
  const shotIdx = { n: 0 };
  let hasBlocks = false;
  let usesEnv = false;
  for (const step of steps) {
    if (isBlockMarker(step.action)) {
      hasBlocks = true;
      body.push("  " + emitMarkerComment(step));
      continue;
    }
    const line = emitStep(step, vars, shotIdx);
    if (line) {
      if (line.includes("process.env[")) usesEnv = true;
      body.push("  " + line);
    }
  }

  const header: string[] = [`import { test, expect } from '@playwright/test';`, ""];
  if (usesEnv)
    header.push(
      `// Some values come from secret/parameterized variables — set them as environment`,
      `// variables (e.g. process.env["password"]) before running.`,
      "",
    );
  if (hasBlocks)
    header.push(
      `// NOTE: this test uses conditional/loop blocks, shown below as comments. The steps`,
      `// currently run unconditionally — translate the marked blocks to if/for/while as needed.`,
      "",
    );

  return (
    header.join("\n") +
    `test(${title}, async ({ page }) => {\n` +
    (body.length ? body.join("\n") : "  // (no steps)") +
    `\n});\n`
  );
}
