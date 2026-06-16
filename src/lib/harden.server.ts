// Server-only Phase C hardening pass. Drives the spec through a real browser and, for
// each selector step, replaces the locator with the most stable candidate that PROVABLY
// resolves to exactly one element — the same element the original locator pointed at on
// the live page. Stores ranked fallbacks too. Runs on the Node server only (not the
// Cloudflare Worker), like the runner. See docs/codegen-reliable-selectors.md.
import { resolveLocator, type Step } from "@/lib/playwright-runner.server";
import { locatorLabel } from "@/lib/locator";
import { candidatesFromDescriptor, type ElementDescriptor } from "@/lib/harden-core";

export type HardenStatus = "improved" | "kept" | "unresolved";

export type HardenReportEntry = {
  idx: number;
  action: string;
  original: string;
  status: HardenStatus;
  hardened?: string;
  fallbacks?: string[];
};

export type HardenResult = { steps: Step[]; report: HardenReportEntry[] };

const SELECTOR_ACTIONS = new Set([
  "click",
  "fill",
  "expect_text",
  "expect_visible",
  "expect_value",
  "expect_count",
]);

// Reads the descriptor used to generate candidates. Runs in the browser context.
const DESCRIBE = (el: Element): ElementDescriptor => {
  const e = el as HTMLElement;
  const getA = (n: string) => e.getAttribute(n) || undefined;
  let labelText: string | undefined;
  const id = e.id;
  if (id) {
    const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (l) labelText = (l.textContent || "").trim() || undefined;
  }
  if (!labelText) {
    const wrap = e.closest("label");
    if (wrap) labelText = (wrap.textContent || "").trim() || undefined;
  }
  return {
    tag: e.tagName.toLowerCase(),
    id: id || undefined,
    testid: getA("data-testid") || getA("data-test-id") || getA("data-test"),
    name: getA("name"),
    type: getA("type"),
    role: getA("role"),
    ariaLabel: getA("aria-label"),
    placeholder: getA("placeholder"),
    text: ((e.textContent || "").trim() || undefined)?.slice(0, 80),
    labelText,
  };
};

export async function hardenBrowserSteps(
  steps: Step[],
  opts: { stepTimeoutMs?: number; gotoTimeoutMs?: number; headless?: boolean } = {},
): Promise<HardenResult> {
  const stepTimeout = opts.stepTimeoutMs ?? 8000;
  const gotoTimeout = opts.gotoTimeoutMs ?? 15000;
  const headless = opts.headless ?? true;

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless });
  const page = await (await browser.newContext()).newPage();

  // Bundlers (esbuild/tsx/vite) decorate functions with a `__name` helper via keepNames;
  // when Playwright serializes our evaluate() callbacks into the page, that helper is
  // undefined there. Shim it on every document so passed-in functions run.
  await page.addInitScript(
    "globalThis.__name = globalThis.__name || function (f) { return f; };",
  );

  const outSteps: Step[] = steps.map((s) => ({ ...s }));
  const report: HardenReportEntry[] = [];

  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];

      if (s.action === "goto") {
        await page
          .goto(s.target ?? "", { waitUntil: "domcontentloaded", timeout: gotoTimeout })
          .catch(() => {});
        continue;
      }
      if (s.action === "expect_url_contains") continue;
      if (!SELECTOR_ACTIONS.has(s.action)) continue;

      const locSource = s.locator ?? s.target;
      if (locSource == null) continue;
      const original = locatorLabel(locSource);

      // Find the element the original locator points at on the live page.
      const baseLoc = resolveLocator(page, locSource).first();
      let target: any = null;
      try {
        await baseLoc.waitFor({ state: "attached", timeout: stepTimeout });
        target = await baseLoc.elementHandle();
      } catch {
        target = null;
      }

      if (!target) {
        report.push({ idx: i, action: s.action, original, status: "unresolved" });
        // Can't proceed reliably past an unresolvable step.
        break;
      }

      // Generate candidates from the element, then keep only those that PROVABLY resolve
      // to exactly one element that is this same element.
      const desc: ElementDescriptor = await target.evaluate(DESCRIBE);
      const candidates = candidatesFromDescriptor(desc);
      const validated = [];
      for (const cand of candidates) {
        try {
          const loc = resolveLocator(page, cand);
          if ((await loc.count()) !== 1) continue;
          const same = await loc.first().evaluate((el: Element, t: Element) => el === t, target);
          if (same) validated.push(cand);
        } catch {
          /* candidate not usable — skip */
        }
      }

      if (validated.length > 0) {
        const primary = validated[0];
        const fallbacks = validated.slice(1, 3);
        outSteps[i].locator = primary;
        delete outSteps[i].target; // prefer the structured, validated locator
        outSteps[i].fallbacks = fallbacks;
        const hardened = locatorLabel(primary);
        report.push({
          idx: i,
          action: s.action,
          original,
          status: hardened === original ? "kept" : "improved",
          hardened,
          fallbacks: fallbacks.map(locatorLabel),
        });
      } else {
        report.push({ idx: i, action: s.action, original, status: "kept" });
      }

      // Advance page state so the next step is evaluated in the right context.
      try {
        if (s.action === "click") await target.click({ timeout: stepTimeout });
        else if (s.action === "fill") await target.fill(s.value ?? "", { timeout: stepTimeout });
      } catch {
        /* best-effort; hardening of this step already recorded */
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return { steps: outSteps, report };
}
