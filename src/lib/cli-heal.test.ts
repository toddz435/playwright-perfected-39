import { describe, it, expect } from "vitest";
import {
  locatorFromError,
  parsePlaywrightFailures,
  rewriteLocatorCall,
  isPlausibleLocator,
  pageUrlForLocator,
} from "./cli-heal";

describe("locatorFromError", () => {
  it("extracts the locator from a 'waiting for' timeout", () => {
    const msg =
      "locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Sign in' })";
    expect(locatorFromError(msg)).toBe("getByRole('button', { name: 'Sign in' })");
  });
  it("extracts from a 'Locator:' expect failure", () => {
    expect(locatorFromError("expect(locator).toBeVisible() failed\n\nLocator: getByText('Welcome')")).toBe(
      "getByText('Welcome')",
    );
  });
  it("extracts a plain locator() call", () => {
    expect(locatorFromError("waiting for locator('#email')")).toBe("locator('#email')");
  });
  it("does NOT truncate a locator whose argument contains parentheses or quotes", () => {
    expect(locatorFromError("waiting for getByText('Save (draft)')")).toBe(
      "getByText('Save (draft)')",
    );
    expect(locatorFromError(`Locator: getByRole('button', { name: 'Save (now)' })`)).toBe(
      "getByRole('button', { name: 'Save (now)' })",
    );
  });
  it("returns null when there's no locator in the message", () => {
    expect(locatorFromError("Some unrelated assertion error")).toBeNull();
    expect(locatorFromError("")).toBeNull();
  });
});

describe("isPlausibleLocator", () => {
  it("accepts well-formed single locator calls (incl. inner parens)", () => {
    expect(isPlausibleLocator("getByLabel('Email')")).toBe(true);
    expect(isPlausibleLocator("getByRole('button', { name: 'Save (now)' })")).toBe(true);
    expect(isPlausibleLocator("locator('.btn')")).toBe(true);
  });
  it("rejects garbage / injection / non-locator responses", () => {
    expect(isPlausibleLocator("")).toBe(false);
    expect(isPlausibleLocator("click the button")).toBe(false);
    expect(isPlausibleLocator("getByLabel('Email'); page.goto('http://evil')")).toBe(false); // semicolon
    expect(isPlausibleLocator("getByLabel('Email')\nawait x")).toBe(false); // newline
    expect(isPlausibleLocator("getByLabel('Email').click()")).toBe(false); // trailing chain, not just the call
    expect(isPlausibleLocator("page.getByLabel('Email')")).toBe(false); // leading page.
  });
});

describe("parsePlaywrightFailures", () => {
  it("collects failed results across nested suites with inherited file + extracted locator", () => {
    const report = {
      suites: [
        {
          file: "login.spec.ts",
          specs: [
            {
              title: "logs in",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      errors: [{ message: "waiting for getByLabel('Email')" }],
                    },
                  ],
                },
              ],
            },
          ],
          suites: [
            {
              specs: [
                {
                  title: "nested",
                  tests: [{ results: [{ status: "passed", errors: [] }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const fails = parsePlaywrightFailures(report);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatchObject({
      file: "login.spec.ts",
      title: "logs in",
      locator: "getByLabel('Email')",
    });
  });

  it("includes timedOut results and the singular `error` field", () => {
    const report = {
      suites: [
        {
          file: "a.spec.ts",
          specs: [
            {
              title: "t",
              tests: [{ results: [{ status: "timedOut", error: { message: "waiting for locator('.x')" } }] }],
            },
          ],
        },
      ],
    };
    expect(parsePlaywrightFailures(report)[0].locator).toBe("locator('.x')");
  });

  it("returns [] for an all-passing or empty report", () => {
    expect(parsePlaywrightFailures({ suites: [] })).toEqual([]);
    expect(parsePlaywrightFailures({})).toEqual([]);
  });
});

describe("pageUrlForLocator", () => {
  const src = [
    "await page.goto('https://a.com/login');",
    "await page.getByLabel('Email').fill('x');",
    "await page.goto('https://a.com/dash');",
    "await page.getByText('Welcome').click();",
  ].join("\n");
  it("returns the last goto BEFORE the locator's first use", () => {
    expect(pageUrlForLocator(src, "getByLabel('Email')")).toBe("https://a.com/login");
    expect(pageUrlForLocator(src, "getByText('Welcome')")).toBe("https://a.com/dash");
  });
  it("returns null for a non-literal goto (process.env / template)", () => {
    expect(pageUrlForLocator("await page.goto(process.env.URL);\nawait page.getByText('Hi').click();", "getByText('Hi')")).toBeNull();
  });
  it("returns null when there's no goto before the locator", () => {
    expect(pageUrlForLocator("await page.getByText('Hi').click();", "getByText('Hi')")).toBeNull();
  });
});

describe("rewriteLocatorCall", () => {
  it("replaces every occurrence and counts them", () => {
    const src = `await page.locator('#email').fill('x');\nawait page.locator('#email').click();`;
    const r = rewriteLocatorCall(src, "locator('#email')", "getByLabel('Email')");
    expect(r.count).toBe(2);
    expect(r.source).toBe(
      `await page.getByLabel('Email').fill('x');\nawait page.getByLabel('Email').click();`,
    );
  });
  it("no-ops when the old call is absent, empty, or unchanged", () => {
    expect(rewriteLocatorCall("abc", "locator('#z')", "x")).toEqual({ source: "abc", count: 0 });
    expect(rewriteLocatorCall("abc", "", "x")).toEqual({ source: "abc", count: 0 });
    expect(rewriteLocatorCall("abc", "abc", "abc")).toEqual({ source: "abc", count: 0 });
  });
  it("only rewrites real .member calls, not a bare occurrence in a comment/string", () => {
    const src = `// avoid locator('.btn') in comments\nawait page.locator('.btn').click();`;
    const r = rewriteLocatorCall(src, "locator('.btn')", "getByRole('button')");
    expect(r.count).toBe(1); // only the page.locator call, not the comment
    expect(r.source).toBe(
      `// avoid locator('.btn') in comments\nawait page.getByRole('button').click();`,
    );
  });
});
