import type { Page } from "playwright";
import { findElement, resolveLocator } from "./locator-resolver";

export interface TestStep {
  action: string;
  target: string;
  value?: string;
  fallbacks?: string[];
  rationale?: string;
  name?: string;
}

export interface StepResult {
  idx: number;
  name?: string;
  action: string;
  target: string;
  value?: string;
  status: "passed" | "failed" | "skipped" | "running";
  duration_ms: number;
  error?: string;
  screenshot?: string; // base64 PNG
  usedFallback?: boolean;
  resolvedTarget?: string;
}

export interface ExecuteStepOptions {
  /** Capture screenshot on failure */
  screenshotOnFailure?: boolean;
  /** Capture screenshot after every step */
  screenshotEveryStep?: boolean;
  /** Fast-forward mode: run navigational actions but skip assertions */
  fastForward?: boolean;
  /** Timeout for locator resolution in ms */
  locatorTimeout?: number;
  /** Timeout for navigation in ms */
  navigationTimeout?: number;
}

const ASSERTION_ACTIONS = new Set([
  "expect_visible",
  "expect_text",
  "expect_url",
  "expect_url_contains",
  "expect_value",
  "expect_count",
]);

/**
 * Execute a single test step using real Playwright.
 * In fast-forward mode, navigational actions execute but assertions are skipped.
 */
export async function executeStep(
  page: Page,
  step: TestStep,
  idx: number,
  options: ExecuteStepOptions = {},
): Promise<StepResult> {
  const {
    screenshotOnFailure = true,
    screenshotEveryStep = false,
    fastForward = false,
    locatorTimeout = 5000,
    navigationTimeout = 30000,
  } = options;

  const t0 = Date.now();

  // In fast-forward mode, skip assertion-only steps
  if (fastForward && ASSERTION_ACTIONS.has(step.action)) {
    return {
      idx,
      name: step.name,
      action: step.action,
      target: step.target,
      value: step.value,
      status: "skipped",
      duration_ms: Date.now() - t0,
    };
  }

  try {
    await runAction(page, step, { locatorTimeout, navigationTimeout });

    const result: StepResult = {
      idx,
      name: step.name,
      action: step.action,
      target: step.target,
      value: step.value,
      status: fastForward ? "skipped" : "passed",
      duration_ms: Date.now() - t0,
    };

    if (screenshotEveryStep && !fastForward) {
      result.screenshot = await captureScreenshot(page);
    }

    return result;
  } catch (err) {
    const result: StepResult = {
      idx,
      name: step.name,
      action: step.action,
      target: step.target,
      value: step.value,
      status: "failed",
      duration_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };

    if (screenshotOnFailure) {
      result.screenshot = await captureScreenshot(page);
    }

    return result;
  }
}

async function runAction(
  page: Page,
  step: TestStep,
  opts: { locatorTimeout: number; navigationTimeout: number },
): Promise<void> {
  const { action, target, value } = step;

  switch (action) {
    case "goto":
      await page.goto(target, { timeout: opts.navigationTimeout, waitUntil: "domcontentloaded" });
      break;

    case "click": {
      const { locator } = await findElement(page, target, step.fallbacks, opts.locatorTimeout);
      await locator.click({ timeout: opts.locatorTimeout });
      break;
    }

    case "fill": {
      const { locator } = await findElement(page, target, step.fallbacks, opts.locatorTimeout);
      await locator.fill(value ?? "", { timeout: opts.locatorTimeout });
      break;
    }

    case "press": {
      if (target && !isKeyName(target)) {
        // target is a locator, value is the key
        const { locator } = await findElement(page, target, step.fallbacks, opts.locatorTimeout);
        await locator.press(value ?? "Enter", { timeout: opts.locatorTimeout });
      } else {
        // target is the key itself (e.g. "Enter", "Tab")
        await page.keyboard.press(target || value || "Enter");
      }
      break;
    }

    case "wait": {
      const ms = parseInt(value || target, 10);
      if (!isNaN(ms)) {
        await page.waitForTimeout(ms);
      } else {
        // Wait for a selector to appear
        const loc = resolveLocator(page, target);
        await loc.first().waitFor({ state: "visible", timeout: opts.locatorTimeout });
      }
      break;
    }

    case "expect_visible": {
      const { locator, usedFallback, usedTarget } = await findElement(
        page,
        target,
        step.fallbacks,
        opts.locatorTimeout,
      );
      await locator.waitFor({ state: "visible", timeout: opts.locatorTimeout });
      if (usedFallback) {
        step.resolvedTarget = usedTarget;
      }
      break;
    }

    case "expect_text": {
      const { locator } = await findElement(page, target, step.fallbacks, opts.locatorTimeout);
      if (value) {
        await assertContainsText(locator, value, opts.locatorTimeout);
      } else {
        await locator.waitFor({ state: "visible", timeout: opts.locatorTimeout });
      }
      break;
    }

    case "expect_url": {
      await page.waitForURL(value || target, { timeout: opts.navigationTimeout });
      break;
    }

    case "expect_url_contains": {
      const expected = value || target;
      await page.waitForFunction(
        (substr: string) => window.location.href.includes(substr),
        expected,
        { timeout: opts.navigationTimeout },
      );
      break;
    }

    case "expect_value": {
      const { locator } = await findElement(page, target, step.fallbacks, opts.locatorTimeout);
      await assertHasValue(locator, value || "", opts.locatorTimeout);
      break;
    }

    case "expect_count": {
      const count = parseInt(value || "0", 10);
      const loc = resolveLocator(page, target);
      await assertHasCount(loc, count, opts.locatorTimeout);
      break;
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/** Poll-based text assertion using native Playwright API (avoids playwright/test import) */
async function assertContainsText(locator: import("playwright").Locator, expected: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastText = "";
  while (Date.now() < deadline) {
    try {
      lastText = (await locator.textContent({ timeout: 1000 })) || "";
      if (lastText.includes(expected)) return;
    } catch { /* element may not exist yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Expected text "${expected}" but got "${lastText.slice(0, 200)}"`);
}

async function assertHasValue(locator: import("playwright").Locator, expected: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastValue = "";
  while (Date.now() < deadline) {
    try {
      lastValue = await locator.inputValue({ timeout: 1000 });
      if (lastValue === expected) return;
    } catch { /* element may not exist yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Expected value "${expected}" but got "${lastValue}"`);
}

async function assertHasCount(locator: import("playwright").Locator, expected: number, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastCount = -1;
  while (Date.now() < deadline) {
    try {
      lastCount = await locator.count();
      if (lastCount === expected) return;
    } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Expected count ${expected} but got ${lastCount}`);
}

function isKeyName(s: string): boolean {
  const keys = new Set([
    "Enter",
    "Tab",
    "Escape",
    "Backspace",
    "Delete",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "F1",
    "F2",
    "F3",
    "F4",
    "F5",
    "F6",
    "F7",
    "F8",
    "F9",
    "F10",
    "F11",
    "F12",
  ]);
  return keys.has(s);
}

async function captureScreenshot(page: Page): Promise<string> {
  try {
    const buf = await page.screenshot({ type: "png", fullPage: false });
    return buf.toString("base64");
  } catch {
    return "";
  }
}
