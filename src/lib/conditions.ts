// Per-step condition guard ("run this step only if …"). Shared, client-safe vocabulary used
// by the step editor (UI) and the runner (server). The actual Playwright evaluation lives in
// playwright-runner.server.ts; this file holds only types + pure label helpers.
import { type Locator, locatorLabel } from "@/lib/locator";

export type ConditionKind = "visible" | "hidden" | "exists" | "not_exists" | "url_contains";

export const CONDITION_KINDS: ConditionKind[] = [
  "visible",
  "hidden",
  "exists",
  "not_exists",
  "url_contains",
];

// url_contains compares against the page URL (target = substring); the rest target an element.
export const URL_CONDITION_KINDS = new Set<ConditionKind>(["url_contains"]);

export type StepCondition = {
  kind: ConditionKind;
  target?: string; // element selector for element kinds; URL substring for url_contains
  locator?: Locator; // optional structured locator (element kinds)
};

// The locator source for an element condition: structured locator if present, else the
// raw target string. Mirrors how the runner resolves a step's locator (`locator ?? target`).
export const conditionSrc = (c: StepCondition): Locator | string | undefined =>
  c.locator ?? c.target;

// Human-readable "only if …" label for editor + run history.
export function conditionLabel(c: StepCondition): string {
  if (URL_CONDITION_KINDS.has(c.kind)) return `only if url contains "${c.target ?? ""}"`;
  const where = c.locator ? locatorLabel(c.locator) : (c.target ?? "");
  return `only if ${c.kind.replace("_", " ")}: ${where}`;
}
