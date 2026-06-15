// Canonical, engine-agnostic locator model shared by Codegen output, the runtime
// engine, and the healer. Client-safe (no Playwright import). The engine-side
// resolveLocator() lives in playwright-runner.server.ts since it needs a Page.
// See docs/codegen-reliable-selectors.md.

export type Locator =
  | { by: "testid"; value: string }
  | { by: "role"; role: string; name?: string }
  | { by: "label"; value: string }
  | { by: "placeholder"; value: string }
  | { by: "text"; value: string }
  | { by: "css"; value: string }
  | { by: "xpath"; value: string };

// Locators a Codegen recording can produce, ranked most → least stable. Used to pick
// the best candidate and to flag "brittle" ones (css/xpath) for an LLM hardening pass.
export const LOCATOR_STABILITY: Locator["by"][] = [
  "testid",
  "role",
  "label",
  "placeholder",
  "text",
  "css",
  "xpath",
];

export function isBrittle(loc: Locator): boolean {
  return loc.by === "css" || loc.by === "xpath";
}

// A short human-readable label for a locator (result display, heal context, logs).
export function locatorLabel(src: Locator | string | undefined): string {
  if (src == null) return "";
  if (typeof src === "string") return src;
  switch (src.by) {
    case "testid":
      return `testid=${src.value}`;
    case "role":
      return `role=${src.role}${src.name ? `[name="${src.name}"]` : ""}`;
    case "label":
      return `label=${src.value}`;
    case "placeholder":
      return `placeholder=${src.value}`;
    case "text":
      return `text=${src.value}`;
    case "css":
      return src.value;
    case "xpath":
      return `xpath=${src.value}`;
    default:
      return JSON.stringify(src);
  }
}
