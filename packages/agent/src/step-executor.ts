import type { Page } from "playwright";
import { findElement, resolveLocator } from "./locator-resolver.js";

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
  screenshot?: string;
  usedFallback?: boolean;
  resolvedTarget?: string;
}

export interface ExecuteStepOptions {
  screenshotOnFailure?: boolean;
  screenshotEveryStep?: boolean;
  fastForward?: boolean;
  locatorTimeout?: number;
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
      await page.goto(target, {
        timeout: opts.navigationTimeout,
        waitUntil: "domcontentloaded",
      });
      break;

    case "click": {
      const { locator } = await findElement(
        page,
        target,
        step.fallbacks,
        opts.locatorTimeout,
      );
      await locator.click({ timeout: opts.locatorTimeout });
      break;
    }

    case "fill": {
      const { locator } = await findElement(
        page,
        target,
        step.fallbacks,
        opts.locatorTimeout,
      );
      await locator.fill(value ?? "", { timeout: opts.locatorTimeout });
      break;
    }

    case "press": {
      if (target && !isKeyName(target)) {
        const { locator } = await findElement(
          page,
          target,
          step.fallbacks,
          opts.locatorTimeout,
        );
        await locator.press(value ?? "Enter", {
          timeout: opts.locatorTimeout,
        });
      } else {
        await page.keyboard.press(target || value || "Enter");
      }
      break;
    }

    case "wait": {
      const ms = parseInt(value || target, 10);
      if (!isNaN(ms)) {
        await page.waitForTimeout(ms);
      } else {
        const loc = resolveLocator(page, target);
        await loc
          .first()
          .waitFor({ state: "visible", timeout: opts.locatorTimeout });
      }
      break;
    }

    case "expect_visible": {
      const { locator } = await findElement(
        page,
        target,
        step.fallbacks,
        opts.locatorTimeout,
      );
      await locator.waitFor({ state: "visible", timeout: opts.locatorTimeout });
      break;
    }

    case "expect_text": {
      const { locator } = await findElement(
        page,
        target,
        step.fallbacks,
        opts.locatorTimeout,
      );
      if (value) {
        const { expect } = await import("playwright/test");
        await expect(locator).toContainText(value, {
          timeout: opts.locatorTimeout,
        });
      } else {
        await locator.waitFor({
          state: "visible",
          timeout: opts.locatorTimeout,
        });
      }
      break;
    }

    case "expect_url":
      await page.waitForURL(value || target, {
        timeout: opts.navigationTimeout,
      });
      break;

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
      const { locator } = await findElement(
        page,
        target,
        step.fallbacks,
        opts.locatorTimeout,
      );
      const { expect } = await import("playwright/test");
      await expect(locator).toHaveValue(value || "", {
        timeout: opts.locatorTimeout,
      });
      break;
    }

    case "expect_count": {
      const count = parseInt(value || "0", 10);
      const loc = resolveLocator(page, target);
      const { expect } = await import("playwright/test");
      await expect(loc).toHaveCount(count, { timeout: opts.locatorTimeout });
      break;
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
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
