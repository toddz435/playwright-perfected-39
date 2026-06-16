// Pure step-spec transform for Phase D self-stabilization. Given the original steps and
// a run's step results, promote any locator that recovered a failed step (via a stored
// fallback or the AI healer) to be that step's primary locator — so the next run uses the
// working locator directly. See docs/codegen-reliable-selectors.md.
import type { Step } from "@/lib/playwright-runner.server";
import type { Locator } from "@/lib/locator";

export type RecoveryResult = {
  idx: number;
  recovery?: "fallback" | "ai";
  new_locator?: Locator | string;
};

export function applyRecoveries(
  steps: Step[],
  results: RecoveryResult[],
): { steps: Step[]; changed: number } {
  const out: Step[] = steps.map((s) => ({ ...s }));
  let changed = 0;

  for (const r of results) {
    if (!r.recovery || r.new_locator == null) continue;
    const i = r.idx;
    if (i < 0 || i >= out.length) continue;
    const nl = r.new_locator;

    if (typeof nl === "string") {
      // AI heal returned a selector string — store as the legacy target, drop structured.
      out[i] = { ...out[i], target: nl, locator: undefined };
    } else {
      // A structured fallback worked — promote it and remove it from the fallbacks list.
      const fallbacks = (out[i].fallbacks ?? []).filter(
        (f) => JSON.stringify(f) !== JSON.stringify(nl),
      );
      out[i] = { ...out[i], locator: nl, target: undefined, fallbacks };
    }
    changed++;
  }

  return { steps: out, changed };
}
