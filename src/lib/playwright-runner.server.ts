// Server-only real Playwright execution engine for browser tests.
//
// Runs in-process on the Node dev/preview server. NOTE: this cannot run inside a
// Cloudflare Worker (Playwright needs Node + native browser binaries); for production
// this module is intended to live in a separate Node "runner" service that the Worker
// calls. Locally (`vite dev`) it runs directly. The import is dynamic so bundling the
// Worker build never tries to pull Playwright in.

import { type Locator, locatorLabel } from "@/lib/locator";
import {
  type StepCondition,
  conditionLabel,
  conditionSrc,
  URL_CONDITION_KINDS,
} from "@/lib/conditions";
import { validateBlocks, isBlockMarker, loopBounds } from "@/lib/blocks";

export type Step = {
  action: string;
  // Legacy: a CSS string for selector actions, or a URL for goto/expect_url_contains.
  target?: string;
  // Preferred for selector-based actions: a structured, resolvable locator.
  locator?: Locator;
  // Ranked alternates tried (deterministically) before the LLM healer — see Phase D.
  fallbacks?: Locator[];
  value?: string;
  // Stable id for a `screenshot` step — keys its visual-regression baseline so the
  // baseline survives reordering/inserting steps. Assigned in the step editor.
  sid?: string;
  // Optional guard: the step runs only if this condition holds (else it's skipped). Used
  // for optional interactions like dismissing a cookie banner that may not appear.
  condition?: StepCondition;
  // On a `repeat` marker: loop config. "times" repeats `count` times; "while" repeats as long
  // as `condition` holds (reuses the `condition` field above). Always bounded by hard caps.
  loop?: { mode: "times" | "while"; count?: number };
};

// Resolves a locator (structured, or a legacy CSS/native-engine string) to a Playwright
// Locator. A plain string flows through page.locator(), which accepts CSS plus native
// engines like `text=`/`xpath=` — keeping pre-existing CSS tests and string heals working.
export function resolveLocator(page: any, src: Locator | string): any {
  if (typeof src === "string") return page.locator(src);
  switch (src.by) {
    case "testid":
      return page.getByTestId(src.value);
    case "role":
      return page.getByRole(src.role as any, src.name ? { name: src.name } : undefined);
    case "label":
      return page.getByLabel(src.value);
    case "placeholder":
      return page.getByPlaceholder(src.value);
    case "text":
      return page.getByText(src.value);
    case "css":
      return page.locator(src.value);
    case "xpath":
      return page.locator(`xpath=${src.value}`);
    default:
      return page.locator(String((src as any).value ?? ""));
  }
}

// Evaluates a step's condition guard against the live page. Returns true → run the step,
// false → skip it. Quick, best-effort: element checks use a short settle window and any
// thrown error resolves to "not met" (skip) so a flaky guard never crashes the run.
const CONDITION_SETTLE_MS = 2000;
async function evalCondition(page: any, cond: StepCondition): Promise<boolean> {
  try {
    if (URL_CONDITION_KINDS.has(cond.kind)) {
      // url_contains — poll briefly so a just-triggered navigation can settle.
      const needle = String(cond.target ?? "");
      const deadline = Date.now() + CONDITION_SETTLE_MS;
      while (!page.url().includes(needle) && Date.now() < deadline) {
        await page.waitForTimeout(150);
      }
      return page.url().includes(needle);
    }
    const src = conditionSrc(cond);
    if (src == null || (typeof src === "string" && src.trim() === "")) return false;
    // Map each element kind to a Playwright waitFor state so all four get a uniform settle
    // window (no racy single-shot snapshots). attached/detached cover exists/not_exists;
    // hidden also resolves immediately for a detached element ("act once it's gone").
    const state =
      cond.kind === "visible"
        ? "visible"
        : cond.kind === "hidden"
          ? "hidden"
          : cond.kind === "exists"
            ? "attached"
            : cond.kind === "not_exists"
              ? "detached"
              : null;
    if (!state) return false;
    return await resolveLocator(page, src)
      .first()
      .waitFor({ state, timeout: CONDITION_SETTLE_MS })
      .then(() => true)
      .catch(() => false);
  } catch {
    return false; // never let a guard break the run — treat as "not met" and skip
  }
}

// One open if-block. `condTrue` = the if's condition result; `inElse` = we're past the `else`.
// The frame's body executes when (then-branch && condTrue) or (else-branch && !condTrue).
type CtrlFrame = { condTrue: boolean; inElse: boolean };
const frameRuns = (f: CtrlFrame) => (f.inElse ? !f.condTrue : f.condTrue);
// A step executes only if every enclosing block frame is currently running its branch.
const blockActive = (ctrl: CtrlFrame[]) => ctrl.every(frameRuns);

// HARD safety caps for loops — a `while` condition that never flips, or a huge `count`, can
// never hang the runner or spin forever (reliability/security). Always enforced.
const MAX_LOOP_ITERATIONS = 100;
const MAX_LOOP_MS = 120_000; // 2 minutes of wall-clock per loop
// One open `repeat` loop. `iter` is the 1-based current iteration; `condition` is the while
// guard (undefined for count loops); `count` is the times target (capped).
type LoopFrame = {
  repeatIndex: number;
  endIndex: number;
  mode: "times" | "while";
  count: number;
  condition?: StepCondition;
  iter: number;
  startedAt: number;
};

export type StepStatus = "passed" | "failed" | "skipped" | "healed";

export type StepResult = {
  idx: number;
  status: StepStatus;
  action?: string;
  target?: string;
  value?: string;
  duration_ms?: number;
  error?: string;
  // Why a step was skipped (e.g. its condition guard was not met).
  skipped_reason?: string;
  // 1-based loop iteration this result belongs to (set for steps inside a `repeat` block).
  iteration?: number;
  // Present when the step's locator was auto-healed before it passed:
  healed_from?: string;
  healed_to?: string;
  // How a healed step recovered, and the locator that worked (for persistence — Phase D).
  recovery?: "fallback" | "ai";
  new_locator?: Locator | string;
  // Base64 PNG captured by a `screenshot` step (consumed/cleared by the runner's
  // visual-regression diff in executeTest; never persisted as base64).
  screenshot?: string;
  // Stable per-screenshot id (from the spec step) used to key its baseline.
  sid?: string;
};

// Called when a selector-based step fails to locate its element. Returns a replacement
// selector to retry with, or null if it cannot suggest one. `html` is the current page
// HTML so the healer can pick a real element.
export type HealFn = (args: {
  selector: string;
  action: string;
  value?: string;
  html: string;
}) => Promise<string | null>;

export type RunOptions = {
  startIdx?: number;
  heal?: HealFn;
  stepTimeoutMs?: number;
  gotoTimeoutMs?: number;
  headless?: boolean;
  // Total wall-clock budget for the whole run; if exceeded the run stops cleanly with a
  // "time budget" failure instead of hanging. Pairs with the per-step/loop caps.
  maxRunMs?: number;
};

const DEFAULT_RUN_BUDGET_MS = 5 * 60 * 1000;

// Errors thrown by step executors. Only LocatorError is considered "healable" — a real
// assertion mismatch (element found, but wrong text/value/count) is a genuine failure.
class LocatorError extends Error {}
class AssertionError extends Error {}

export const SELECTOR_ACTIONS = new Set([
  "click",
  "fill",
  "press",
  "expect_text",
  "expect_visible",
  "expect_value",
  "expect_count",
]);

export async function runBrowserSteps(
  steps: Step[],
  opts: RunOptions = {},
): Promise<{ status: "passed" | "failed"; steps: StepResult[] }> {
  // Resume-from-failed can't reconstruct the if/else control stack for the skipped prefix
  // (conditions can't be re-evaluated without replaying the page), so a test that uses blocks
  // always runs from the start — correct results beat an unsound partial resume.
  const hasBlocks = steps.some((s) => isBlockMarker(s.action));
  const startIdx = hasBlocks ? 0 : Math.max(0, opts.startIdx ?? 0);
  const stepTimeout = opts.stepTimeoutMs ?? 8000;
  const gotoTimeout = opts.gotoTimeoutMs ?? 15000;
  const headless = opts.headless ?? true;
  const maxRunMs = opts.maxRunMs ?? DEFAULT_RUN_BUDGET_MS;
  const runStart = Date.now();

  // Defensive: the editor validates block balance on save, but a spec could reach the runner
  // unbalanced (API/import/older data). Fail fast with a clear error rather than silently
  // mis-gating steps (e.g. a missing `endif` would gate everything after it).
  const blockErr = validateBlocks(steps);
  if (blockErr) {
    return {
      status: "failed",
      steps: [{ idx: 0, status: "failed", action: "blocks", error: blockErr }],
    };
  }

  // Dynamic import keeps Playwright out of the (Cloudflare) bundle graph.
  const { chromium } = await import("@playwright/test");

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  const results: StepResult[] = [];
  let status: "passed" | "failed" = "passed";
  // Control-flow stack for if/else blocks: one frame per open `if`.
  const ctrl: CtrlFrame[] = [];
  // Loop stack: one frame per active `repeat`. Body-step results are stamped with the innermost
  // loop's current iteration via rec().
  const loops: LoopFrame[] = [];
  // Records a step result, stamping the current loop iteration when inside a `repeat`.
  const rec = (r: StepResult) => {
    const it = loops.length ? loops[loops.length - 1].iter : undefined;
    results.push(it != null ? { ...r, iteration: it } : r);
  };

  // Executes one selector-based action against a given selector. Throws LocatorError
  // when the element can't be found/interacted-with, AssertionError on value mismatch.
  const execSelectorStep = async (action: string, src: Locator | string, value?: string) => {
    const locator = resolveLocator(page, src);
    switch (action) {
      case "click":
        try {
          await locator.first().click({ timeout: stepTimeout });
        } catch (e: any) {
          throw new LocatorError(e?.message || "click failed");
        }
        return;
      case "fill":
        try {
          await locator.first().fill(value ?? "", { timeout: stepTimeout });
        } catch (e: any) {
          throw new LocatorError(e?.message || "fill failed");
        }
        return;
      case "press":
        try {
          await locator.first().press(value || "Enter", { timeout: stepTimeout });
        } catch (e: any) {
          throw new LocatorError(e?.message || "press failed");
        }
        return;
      case "expect_visible":
        try {
          await locator.first().waitFor({ state: "visible", timeout: stepTimeout });
        } catch (e: any) {
          throw new LocatorError(e?.message || "element not visible");
        }
        return;
      case "expect_text": {
        try {
          await locator.first().waitFor({ state: "attached", timeout: stepTimeout });
        } catch (e: any) {
          throw new LocatorError(e?.message || "element not found");
        }
        const txt = (await locator.first().textContent()) ?? "";
        if (!txt.includes(value ?? "")) {
          throw new AssertionError(
            `expected text to contain "${value}", got "${txt.trim().slice(0, 120)}"`,
          );
        }
        return;
      }
      case "expect_value": {
        try {
          await locator.first().waitFor({ state: "attached", timeout: stepTimeout });
        } catch (e: any) {
          throw new LocatorError(e?.message || "element not found");
        }
        const v = await locator.first().inputValue();
        if (v !== (value ?? "")) {
          throw new AssertionError(`expected value "${value}", got "${v}"`);
        }
        return;
      }
      case "expect_count": {
        const expected = Number(value);
        if (!Number.isFinite(expected)) {
          throw new AssertionError(
            `expect_count needs a numeric value, got ${JSON.stringify(value)}`,
          );
        }
        // Poll briefly so async-added elements settle.
        const deadline = Date.now() + stepTimeout;
        let count = await locator.count();
        while (count !== expected && Date.now() < deadline) {
          await page.waitForTimeout(150);
          count = await locator.count();
        }
        if (count !== expected) {
          throw new AssertionError(`expected count ${expected}, got ${count}`);
        }
        return;
      }
      default:
        throw new AssertionError(`unknown selector action "${action}"`);
    }
  };

  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (i < startIdx) {
        rec({
          idx: i,
          status: "skipped",
          action: s.action,
          target: s.locator ? locatorLabel(s.locator) : s.target,
          value: s.value,
        });
        continue;
      }

      // Run budget: stop cleanly if the whole run has exceeded its time cap (never hang).
      if (Date.now() - runStart > maxRunMs) {
        rec({
          idx: i,
          status: "failed",
          action: s.action,
          target: s.locator ? locatorLabel(s.locator) : s.target,
          error: `Run exceeded its time budget (${Math.round(maxRunMs / 1000)}s).`,
        });
        status = "failed";
        break;
      }

      // --- control-flow markers (if / else / endif) — see src/lib/blocks.ts ---
      // A frame runs its body when: (then-branch && condition true) OR (else-branch && false).
      // Markers don't emit a StepResult (they aren't real steps — that would inflate the
      // run's step counts); the taken/skipped body steps already show the branch outcome.
      if (s.action === "if") {
        const parentActive = blockActive(ctrl);
        // Only evaluate the condition when the enclosing block is actually executing.
        const condTrue =
          parentActive && s.condition ? await evalCondition(page, s.condition) : false;
        ctrl.push({ condTrue: parentActive ? condTrue : false, inElse: false });
        continue;
      }
      if (s.action === "else") {
        if (ctrl.length) ctrl[ctrl.length - 1].inElse = true;
        continue;
      }
      if (s.action === "endif") {
        if (ctrl.length) ctrl.pop();
        continue;
      }

      // --- loop markers (repeat / endrepeat) — see src/lib/blocks.ts ---
      if (s.action === "repeat") {
        // A repeat inside a not-taken if-branch never runs: skip the marker; its body steps
        // are skipped individually and its endrepeat no-ops (no frame pushed).
        if (!blockActive(ctrl)) continue;
        const bounds = loopBounds(steps, i);
        const endIndex = bounds ? bounds.endrepeatIndex : i; // validateBlocks guarantees a match
        const mode = s.loop?.mode === "while" ? "while" : "times";
        const count = Math.min(
          Math.max(0, Math.floor(Number(s.loop?.count ?? 0))),
          MAX_LOOP_ITERATIONS,
        );
        const enter =
          mode === "while"
            ? s.condition
              ? await evalCondition(page, s.condition)
              : false
            : count > 0;
        if (!enter) {
          i = endIndex; // jump past the body; the loop ran zero times
          continue;
        }
        loops.push({
          repeatIndex: i,
          endIndex,
          mode,
          count,
          condition: mode === "while" ? s.condition : undefined,
          iter: 1,
          startedAt: Date.now(),
        });
        continue; // fall into the body
      }
      if (s.action === "endrepeat") {
        const frame = loops[loops.length - 1];
        // Only the active loop's own endrepeat drives iteration (markers from skipped/zero-run
        // branches no-op).
        if (!frame || frame.endIndex !== i) continue;
        const elapsed = Date.now() - frame.startedAt;
        let again = false;
        if (frame.mode === "times") {
          // `count` is clamped to MAX_LOOP_ITERATIONS at entry, so a times-loop always
          // completes naturally — no safety-cap notice for finishing its intended count.
          again = frame.iter < frame.count;
        } else if (frame.iter >= MAX_LOOP_ITERATIONS || elapsed > MAX_LOOP_MS) {
          // A `while` loop hit the hard safety cap — stop and surface it (never infinite).
          rec({
            idx: i,
            status: "skipped",
            action: "repeat",
            skipped_reason: `loop stopped at safety cap (${frame.iter} iterations${
              elapsed > MAX_LOOP_MS ? `, ${Math.round(elapsed / 1000)}s` : ""
            })`,
          });
        } else {
          again = frame.condition ? await evalCondition(page, frame.condition) : false;
        }
        if (again) {
          frame.iter++;
          i = frame.repeatIndex; // i++ lands back on the first body step
          continue;
        }
        loops.pop();
        continue;
      }

      // Inside a branch that isn't executing → skip this step (never fails the run).
      if (!blockActive(ctrl)) {
        rec({
          idx: i,
          status: "skipped",
          action: s.action,
          target: s.locator ? locatorLabel(s.locator) : s.target,
          value: s.value,
          skipped_reason: "branch not taken",
        });
        continue;
      }

      // Condition guard: if present and not met, skip this step (never fails the run).
      if (s.condition) {
        const met = await evalCondition(page, s.condition);
        if (!met) {
          rec({
            idx: i,
            status: "skipped",
            action: s.action,
            target: s.locator ? locatorLabel(s.locator) : s.target,
            value: s.value,
            skipped_reason: conditionLabel(s.condition),
          });
          continue;
        }
      }

      const sStart = Date.now();

      // Legacy/no-op-ish action from older recordings: best-effort wait, never fatal.
      if (s.action === "wait") {
        const locSrc = s.locator ?? s.target;
        if (locSrc != null) {
          await resolveLocator(page, locSrc)
            .first()
            .waitFor({ state: "visible", timeout: stepTimeout })
            .catch(() => {});
        } else {
          await page.waitForTimeout(Math.min(Number(s.value) || 500, stepTimeout));
        }
        rec({
          idx: i,
          status: "passed",
          action: s.action,
          target: s.locator ? locatorLabel(s.locator) : s.target,
          duration_ms: Date.now() - sStart,
        });
        continue;
      }

      // Visual regression: capture a PNG (element if a locator is given, else viewport;
      // value "fullPage" → full page). The pass/fail diff verdict is decided in executeTest.
      if (s.action === "screenshot") {
        // An empty/whitespace target means "no locator → capture the viewport". `??` alone
        // doesn't catch "" (an empty string is not null), which would otherwise be parsed
        // as a CSS selector and throw "Unexpected token while parsing css selector".
        const rawLoc = s.locator ?? s.target;
        const locSrc =
          rawLoc == null || (typeof rawLoc === "string" && rawLoc.trim() === "") ? null : rawLoc;
        const label = locSrc ? locatorLabel(locSrc) : "(viewport)";
        try {
          const buf =
            locSrc != null
              ? await resolveLocator(page, locSrc).first().screenshot({ timeout: stepTimeout })
              : await page.screenshot({ fullPage: s.value === "fullPage" });
          rec({
            idx: i,
            sid: s.sid, // stable baseline key (survives step reorder); undefined for legacy steps
            status: "passed",
            action: "screenshot",
            target: label,
            duration_ms: Date.now() - sStart,
            screenshot: buf.toString("base64"),
          });
        } catch (e: any) {
          rec({
            idx: i,
            status: "failed",
            action: "screenshot",
            target: label,
            duration_ms: Date.now() - sStart,
            error: e?.message || "screenshot failed",
          });
          status = "failed";
          break;
        }
        continue;
      }

      // Non-selector actions: navigation and URL assertions (not healable).
      if (s.action === "goto") {
        try {
          await page.goto(s.target ?? "", { waitUntil: "domcontentloaded", timeout: gotoTimeout });
          rec({
            idx: i,
            status: "passed",
            action: s.action,
            target: s.target,
            duration_ms: Date.now() - sStart,
          });
        } catch (e: any) {
          rec({
            idx: i,
            status: "failed",
            action: s.action,
            target: s.target,
            duration_ms: Date.now() - sStart,
            error: e?.message || "navigation failed",
          });
          status = "failed";
          break;
        }
        continue;
      }

      if (s.action === "expect_url_contains" || s.action === "expect_url") {
        const deadline = Date.now() + stepTimeout;
        let url = page.url();
        while (!url.includes(s.target ?? "") && Date.now() < deadline) {
          await page.waitForTimeout(150);
          url = page.url();
        }
        if (url.includes(s.target ?? "")) {
          rec({
            idx: i,
            status: "passed",
            action: s.action,
            target: s.target,
            duration_ms: Date.now() - sStart,
          });
        } else {
          rec({
            idx: i,
            status: "failed",
            action: s.action,
            target: s.target,
            duration_ms: Date.now() - sStart,
            error: `url "${url}" did not contain "${s.target}"`,
          });
          status = "failed";
          break;
        }
        continue;
      }

      // Selector-based actions, with auto-heal-and-continue on locator failure.
      // The locator source is the structured `locator` when present, else the legacy
      // `target` string (CSS / native engine).
      const locSource: Locator | string | undefined = s.locator ?? s.target;
      if (SELECTOR_ACTIONS.has(s.action) && locSource != null) {
        const label = locatorLabel(locSource);
        try {
          await execSelectorStep(s.action, locSource, s.value);
          rec({
            idx: i,
            status: "passed",
            action: s.action,
            target: label,
            value: s.value,
            duration_ms: Date.now() - sStart,
          });
          continue;
        } catch (err) {
          // Genuine assertion mismatch — do not heal, stop the run.
          if (err instanceof AssertionError) {
            rec({
              idx: i,
              status: "failed",
              action: s.action,
              target: label,
              value: s.value,
              duration_ms: Date.now() - sStart,
              error: err.message,
            });
            status = "failed";
            break;
          }

          // Phase D: try stored fallbacks first (deterministic, no LLM cost).
          let recoveredViaFallback = false;
          for (const fb of s.fallbacks ?? []) {
            try {
              await execSelectorStep(s.action, fb, s.value);
              rec({
                idx: i,
                status: "healed",
                action: s.action,
                target: locatorLabel(fb),
                value: s.value,
                duration_ms: Date.now() - sStart,
                healed_from: label,
                healed_to: locatorLabel(fb),
                recovery: "fallback",
                new_locator: fb,
              });
              recoveredViaFallback = true;
              break;
            } catch {
              /* fallback didn't work — try the next one */
            }
          }
          if (recoveredViaFallback) continue;

          // Locator failure — attempt to heal with the LLM, then continue from this step.
          if (opts.heal) {
            const html = await page.content().catch(() => "");
            const healed = await opts
              .heal({ selector: label, action: s.action, value: s.value, html })
              .catch(() => null);
            if (healed && healed !== label) {
              try {
                await execSelectorStep(s.action, healed, s.value);
                rec({
                  idx: i,
                  status: "healed",
                  action: s.action,
                  target: healed,
                  value: s.value,
                  duration_ms: Date.now() - sStart,
                  healed_from: label,
                  healed_to: healed,
                  recovery: "ai",
                  new_locator: healed,
                });
                continue; // healed → carry on with the rest of the script
              } catch (retryErr: any) {
                rec({
                  idx: i,
                  status: "failed",
                  action: s.action,
                  target: label,
                  value: s.value,
                  duration_ms: Date.now() - sStart,
                  error: `heal retry failed (${healed}): ${retryErr?.message || retryErr}`,
                });
                status = "failed";
                break;
              }
            }
          }

          rec({
            idx: i,
            status: "failed",
            action: s.action,
            target: label,
            value: s.value,
            duration_ms: Date.now() - sStart,
            error: (err as Error).message,
          });
          status = "failed";
          break;
        }
      }

      // Unknown action — record and stop.
      rec({
        idx: i,
        status: "failed",
        action: s.action,
        target: s.target,
        value: s.value,
        error: `unsupported action "${s.action}"`,
      });
      status = "failed";
      break;
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return { status, steps: results };
}
