import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  executeStep,
  type TestStep,
  type StepResult,
  type ExecuteStepOptions,
} from "./step-executor.js";

export interface BrowserRunOptions {
  startIdx?: number;
  screenshotOnFailure?: boolean;
  screenshotEveryStep?: boolean;
  locatorTimeout?: number;
  navigationTimeout?: number;
  headless?: boolean;
}

export interface BrowserRunResult {
  status: "passed" | "failed";
  stepResults: StepResult[];
}

export async function runBrowserSteps(
  steps: TestStep[],
  options: BrowserRunOptions = {},
): Promise<BrowserRunResult> {
  const {
    startIdx = 0,
    screenshotOnFailure = true,
    screenshotEveryStep = false,
    locatorTimeout = 5000,
    navigationTimeout = 30000,
    headless = true,
  } = options;

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch({ headless });
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: "Testrify-Agent/0.1.0 (Playwright)",
    });
    page = await context.newPage();

    const stepResults: StepResult[] = [];
    let status: "passed" | "failed" = "passed";

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isFastForward = i < startIdx;

      const stepOpts: ExecuteStepOptions = {
        screenshotOnFailure: isFastForward ? false : screenshotOnFailure,
        screenshotEveryStep: isFastForward ? false : screenshotEveryStep,
        fastForward: isFastForward,
        locatorTimeout,
        navigationTimeout,
      };

      const result = await executeStep(page, step, i, stepOpts);
      stepResults.push(result);

      if (result.status === "failed") {
        status = "failed";
        for (let j = i + 1; j < steps.length; j++) {
          stepResults.push({
            idx: j,
            name: steps[j].name,
            action: steps[j].action,
            target: steps[j].target,
            value: steps[j].value,
            status: "skipped",
            duration_ms: 0,
          });
        }
        break;
      }
    }

    return { status, stepResults };
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
