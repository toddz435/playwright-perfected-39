// Server-only selector healer used by the Playwright runner's heal-and-continue loop.
// Given a broken selector and the current page HTML, asks Claude for a replacement
// selector that page.locator() can use. Returns null when healing isn't possible
// (e.g. no API key configured) so the run simply fails as it would have.
import { claudeTool, hasClaudeKey } from "@/lib/claude.server";
import type { HealFn } from "@/lib/playwright-runner.server";

const MAX_HTML = 14000;

export const healSelector: HealFn = async ({ selector, action, value, html }) => {
  if (!hasClaudeKey()) return null;

  // Keep the prompt bounded; the relevant element is usually early-ish in the body.
  const snippet = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;

  try {
    const out = await claudeTool({
      system:
        "You are a Playwright locator expert. A test step's CSS selector failed to find its " +
        "element on the live page. Given the page HTML, return ONE replacement selector that " +
        "page.locator(selector) can use directly — either a stable CSS selector or a Playwright " +
        'text= selector (e.g. "text=Sign in"). Prefer stable attributes (id, name, type, ' +
        "data-* , aria-label, role-conveying markup) over brittle nth-child/auto-generated ids. " +
        "The selector must uniquely match the element the step intended to act on.",
      user:
        `Failed selector: ${selector}\n` +
        `Step action: ${action}${value ? `\nStep value: ${JSON.stringify(value)}` : ""}\n\n` +
        `Page HTML (possibly truncated):\n${snippet}`,
      tool: {
        name: "emit_selector",
        description: "Return the single best replacement selector for page.locator().",
        input_schema: {
          type: "object",
          properties: {
            selector: {
              type: "string",
              description:
                "A single selector usable by page.locator() (CSS or Playwright text= engine).",
            },
            rationale: { type: "string", description: "Why this selector is resilient." },
          },
          required: ["selector"],
          additionalProperties: false,
        },
      },
      maxTokens: 512,
    });
    const healed = typeof out?.selector === "string" ? out.selector.trim() : "";
    return healed || null;
  } catch {
    return null;
  }
};
