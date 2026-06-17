import { describe, it, expect } from "vitest";
import { advisoriesToMarkdown } from "./advisory-format";

const advisory = {
  action: "click",
  currentLocator: ".mystery-x9f2",
  reason: "No test id, ARIA role/name, label, or unique text — nothing stable matched.",
  suggestedTestId: "checkout-button",
  suggestedLocator: "getByTestId('checkout-button')",
  domPath: "html > body > div.mystery-x9f2",
  elementHtml: '<div class="mystery-x9f2">Checkout</div>',
};

describe("advisoriesToMarkdown", () => {
  it("renders a checklist with testid, locator, location, and element", () => {
    const md = advisoriesToMarkdown("Checkout flow", [advisory]);
    expect(md).toContain("# Checkout flow — add `data-testid`s");
    expect(md).toContain('- [ ] Add `data-testid="checkout-button"`');
    expect(md).toContain("getByTestId('checkout-button')");
    expect(md).toContain("html > body > div.mystery-x9f2");
    expect(md).toContain('<div class="mystery-x9f2">Checkout</div>');
    expect(md).toContain("**1**");
  });

  it("renders a clean 'nothing to do' message when empty", () => {
    const md = advisoriesToMarkdown("Login", []);
    expect(md).toContain("No brittle locators found");
    expect(md).not.toContain("- [ ]");
  });
});
