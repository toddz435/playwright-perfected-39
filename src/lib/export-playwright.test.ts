import { describe, it, expect } from "vitest";
import { exportToPlaywright, emitLocator, emitValue } from "./export-playwright";

describe("emitValue", () => {
  const vars = { baseUrl: "https://x.com", who: "Ada" };
  it("returns a plain double-quoted string when there are no tokens", () => {
    expect(emitValue("hello", vars)).toBe('"hello"');
  });
  it("inlines a known plain variable", () => {
    expect(emitValue("{{baseUrl}}/login", vars)).toBe('"https://x.com/login"');
  });
  it("turns an unknown/secret/dataset token into a process.env template", () => {
    expect(emitValue("{{password}}", vars)).toBe('`${process.env["password"] ?? ""}`');
  });
  it("mixes inlined vars and env tokens in one template", () => {
    expect(emitValue("{{who}}:{{password}}", vars)).toBe('`Ada:${process.env["password"] ?? ""}`');
  });
  it("escapes backticks and ${ in literal text when emitting a template", () => {
    expect(emitValue("a`b${c {{password}}", vars)).toContain("a\\`b\\${c ");
  });
});

describe("emitLocator", () => {
  it("maps each locator kind to the right Playwright call", () => {
    expect(emitLocator({ locator: { by: "testid", value: "submit" } })).toBe(
      'page.getByTestId("submit")',
    );
    expect(emitLocator({ locator: { by: "role", role: "button", name: "Save" } })).toBe(
      'page.getByRole("button", { name: "Save" })',
    );
    expect(emitLocator({ locator: { by: "role", role: "list" } })).toBe('page.getByRole("list")');
    expect(emitLocator({ locator: { by: "label", value: "Email" } })).toBe('page.getByLabel("Email")');
    expect(emitLocator({ locator: { by: "placeholder", value: "Search" } })).toBe(
      'page.getByPlaceholder("Search")',
    );
    expect(emitLocator({ locator: { by: "text", value: "Hi" } })).toBe('page.getByText("Hi")');
    expect(emitLocator({ locator: { by: "css", value: ".btn" } })).toBe('page.locator(".btn")');
    expect(emitLocator({ locator: { by: "xpath", value: "//a" } })).toBe('page.locator("xpath=//a")');
  });
  it("falls back to page.locator(target) for a raw target", () => {
    expect(emitLocator({ target: "#id" })).toBe('page.locator("#id")');
  });
});

describe("exportToPlaywright", () => {
  const mk = (steps: any[], extra: any = {}) => ({
    name: "My Test",
    spec: { steps, ...extra },
  });

  it("emits a complete, runnable spec for a linear test", () => {
    const out = exportToPlaywright(
      mk([
        { action: "goto", target: "https://x.com" },
        { action: "fill", locator: { by: "label", value: "Email" }, value: "a@x.com" },
        { action: "click", locator: { by: "role", role: "button", name: "Sign in" } },
        { action: "expect_url_contains", target: "/dashboard" },
        { action: "expect_text", locator: { by: "role", role: "heading" }, value: "Welcome" },
      ]),
    );
    expect(out).toContain("import { test, expect } from '@playwright/test';");
    expect(out).toContain('test("My Test", async ({ page }) => {');
    expect(out).toContain('await page.goto("https://x.com");');
    expect(out).toContain('await page.getByLabel("Email").fill("a@x.com");');
    expect(out).toContain('await page.getByRole("button", { name: "Sign in" }).click();');
    expect(out).toContain('await expect.poll(() => page.url()).toContain("/dashboard");');
    expect(out).toContain('await expect(page.getByRole("heading")).toContainText("Welcome");');
    expect(out.trimEnd().endsWith("});")).toBe(true);
  });

  it("maps the assertion kinds", () => {
    const out = exportToPlaywright(
      mk([
        { action: "expect_visible", locator: { by: "testid", value: "cart" } },
        { action: "expect_value", locator: { by: "label", value: "Qty" }, value: "3" },
        { action: "expect_count", locator: { by: "css", value: ".row" }, value: "5" },
      ]),
    );
    expect(out).toContain('await expect(page.getByTestId("cart")).toBeVisible();');
    expect(out).toContain('await expect(page.getByLabel("Qty")).toHaveValue("3");');
    expect(out).toContain('await expect(page.locator(".row")).toHaveCount(5);');
  });

  it("inlines plain variables but NEVER inlines a secret (even when its encrypted value is in variables)", () => {
    const out = exportToPlaywright(
      mk(
        [
          { action: "goto", target: "{{baseUrl}}/login" },
          { action: "fill", locator: { by: "label", value: "Password" }, value: "{{pw}}" },
        ],
        // pw is BOTH in variables (as an encrypted blob, as it is on the client) AND in secrets.
        { variables: { baseUrl: "https://x.com", pw: "enc:v1:SUPERSECRET" }, secrets: ["pw"] },
      ),
    );
    expect(out).toContain('await page.goto("https://x.com/login");');
    expect(out).toContain('.fill(`${process.env["pw"] ?? ""}`);');
    expect(out).not.toContain("SUPERSECRET"); // the encrypted blob must never leak into the code
    expect(out).toContain("environment");
  });

  it("renders control-flow markers as comments with a note", () => {
    const out = exportToPlaywright(
      mk([
        { action: "repeat", loop: { count: 3 } },
        { action: "click", locator: { by: "text", value: "Next" } },
        { action: "endrepeat" },
      ]),
    );
    expect(out).toContain("// repeat 3× {");
    expect(out).toContain('await page.getByText("Next").click();');
    expect(out).toContain("// }");
    expect(out).toContain("conditional/loop blocks");
  });
});
