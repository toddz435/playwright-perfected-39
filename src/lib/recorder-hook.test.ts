// @vitest-environment node
// The cloud recorder (runner/record.ts) relies on Playwright's PRIVATE context._enableRecorder —
// the API behind `playwright codegen`. This goes red if a Playwright upgrade removes or renames it,
// so the breakage shows up here instead of as a broken Record button in production.
import { describe, it, expect } from "vitest";
import { chromium } from "@playwright/test";

describe("Playwright recorder hook", () => {
  it("still exposes context._enableRecorder", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      expect(typeof (context as unknown as { _enableRecorder?: unknown })._enableRecorder).toBe(
        "function",
      );
    } finally {
      await browser.close();
    }
  }, 30000);
});
