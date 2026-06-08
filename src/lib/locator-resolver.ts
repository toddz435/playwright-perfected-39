import type { Page, Locator } from "playwright";

/**
 * Parses a Testrify locator string and returns a Playwright Locator.
 *
 * Supported prefixes:
 *   role:button[name=Submit]  → page.getByRole('button', { name: 'Submit' })
 *   text:Sign in              → page.getByText('Sign in')
 *   label:Email               → page.getByLabel('Email')
 *   placeholder:Search        → page.getByPlaceholder('Search')
 *   testid:cart-total         → page.getByTestId('cart-total')
 *   alt:Company logo          → page.getByAltText('Company logo')
 *   title:Close dialog        → page.getByTitle('Close dialog')
 *   css:#submit               → page.locator('#submit')
 *   xpath://div[@id='main']   → page.locator('xpath=//div[@id="main"]')
 *
 * If no prefix matches, falls back to page.locator(target) (CSS selector).
 */
export function resolveLocator(page: Page, target: string): Locator {
  // role:button[name=Submit] or role:heading[name=Welcome][level=2]
  const roleMatch = target.match(/^role:(\w+)(?:\[(.+)\])?$/);
  if (roleMatch) {
    const role = roleMatch[1] as Parameters<Page["getByRole"]>[0];
    const attrsStr = roleMatch[2];
    const opts: Record<string, string | number | boolean | RegExp> = {};
    if (attrsStr) {
      // Parse [name=Submit][exact=true][level=2]
      const attrPairs = attrsStr.match(/\w+=[^\]]+/g) || [];
      for (const pair of attrPairs) {
        const eqIdx = pair.indexOf("=");
        const key = pair.slice(0, eqIdx);
        const val = pair.slice(eqIdx + 1);
        if (val === "true") opts[key] = true;
        else if (val === "false") opts[key] = false;
        else if (/^\d+$/.test(val)) opts[key] = Number(val);
        else opts[key] = val;
      }
    }
    return page.getByRole(role, opts);
  }

  if (target.startsWith("text:")) {
    return page.getByText(target.slice(5));
  }

  if (target.startsWith("label:")) {
    return page.getByLabel(target.slice(6));
  }

  if (target.startsWith("placeholder:")) {
    return page.getByPlaceholder(target.slice(12));
  }

  if (target.startsWith("testid:")) {
    return page.getByTestId(target.slice(7));
  }

  if (target.startsWith("alt:")) {
    return page.getByAltText(target.slice(4));
  }

  if (target.startsWith("title:")) {
    return page.getByTitle(target.slice(6));
  }

  if (target.startsWith("css:")) {
    return page.locator(target.slice(4));
  }

  if (target.startsWith("xpath:")) {
    return page.locator(`xpath=${target.slice(6)}`);
  }

  // Bare string — treat as CSS selector
  return page.locator(target);
}

/**
 * Tries the primary locator, then falls back through alternatives in order.
 * Returns the first locator that resolves to a visible element within the timeout.
 */
export async function findElement(
  page: Page,
  target: string,
  fallbacks?: string[],
  timeout = 5000,
): Promise<{ locator: Locator; usedFallback: boolean; usedTarget: string }> {
  const primary = resolveLocator(page, target);

  try {
    await primary.first().waitFor({ state: "visible", timeout });
    return { locator: primary.first(), usedFallback: false, usedTarget: target };
  } catch {
    // Primary failed — try fallbacks
  }

  if (fallbacks?.length) {
    for (const fb of fallbacks) {
      const loc = resolveLocator(page, fb);
      try {
        await loc.first().waitFor({ state: "visible", timeout: Math.min(timeout, 2000) });
        return { locator: loc.first(), usedFallback: true, usedTarget: fb };
      } catch {
        // Continue to next fallback
      }
    }
  }

  // Nothing found — return primary so the caller gets a clear error
  return { locator: primary.first(), usedFallback: false, usedTarget: target };
}
