import { describe, it, expect } from "vitest";
import { parseCodegen, extractLocator } from "./codegen-parse";

describe("extractLocator", () => {
  it("parses getByTestId", () => {
    expect(extractLocator("page.getByTestId('cart-total').click()")).toEqual({
      by: "testid",
      value: "cart-total",
    });
  });

  it("parses getByRole with a string name", () => {
    expect(extractLocator("page.getByRole('button', { name: 'Sign in' }).click()")).toEqual({
      by: "role",
      role: "button",
      name: "Sign in",
    });
  });

  it("parses getByRole with extra options and exact", () => {
    expect(extractLocator("page.getByRole('link', { name: 'Home', exact: true }).click()")).toEqual(
      { by: "role", role: "link", name: "Home" },
    );
  });

  it("parses getByRole with no name", () => {
    expect(extractLocator("page.getByRole('list').click()")).toEqual({ by: "role", role: "list" });
  });

  it("parses getByRole with a regex name (uses the source)", () => {
    expect(extractLocator("page.getByRole('button', { name: /submit/i }).click()")).toEqual({
      by: "role",
      role: "button",
      name: "submit",
    });
  });

  it("parses getByLabel / getByPlaceholder / getByText", () => {
    expect(extractLocator("page.getByLabel('Email').fill('a')")).toEqual({
      by: "label",
      value: "Email",
    });
    expect(extractLocator("page.getByPlaceholder('Search').fill('a')")).toEqual({
      by: "placeholder",
      value: "Search",
    });
    expect(extractLocator("page.getByText('Welcome').click()")).toEqual({
      by: "text",
      value: "Welcome",
    });
  });

  it("parses locator() as css, and xpath= / // as xpath", () => {
    expect(extractLocator("page.locator('#email-x82a').fill('a')")).toEqual({
      by: "css",
      value: "#email-x82a",
    });
    expect(extractLocator("page.locator('xpath=//div[3]/span').click()")).toEqual({
      by: "xpath",
      value: "//div[3]/span",
    });
    expect(extractLocator("page.locator('//button').click()")).toEqual({
      by: "xpath",
      value: "//button",
    });
  });

  it("returns null when no locator is present", () => {
    expect(extractLocator("page.waitForLoadState()")).toBeNull();
  });
});

describe("parseCodegen", () => {
  it("maps actions and assertions to engine steps", () => {
    const script = `
      await page.goto('https://example.com/login');
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByText('Welcome')).toBeVisible();
      await expect(page).toHaveURL('https://example.com/dashboard');
    `;
    const { steps, brittle, unparsed } = parseCodegen(script);
    expect(steps).toEqual([
      { action: "goto", target: "https://example.com/login" },
      { action: "fill", locator: { by: "label", value: "Email" }, value: "test@example.com" },
      { action: "click", locator: { by: "role", role: "button", name: "Sign in" } },
      { action: "expect_visible", locator: { by: "text", value: "Welcome" } },
      { action: "expect_url_contains", target: "https://example.com/dashboard" },
    ]);
    expect(brittle).toEqual([]);
    expect(unparsed).toEqual([]);
  });

  it("flags css/xpath locators as brittle by step index", () => {
    const script = `
      await page.goto('https://x.com');
      await page.locator('#email-x82a').fill('a@b.com');
      await page.getByRole('button', { name: 'Go' }).click();
      await page.locator('div.css-1q2w button').click();
    `;
    const { steps, brittle } = parseCodegen(script);
    expect(steps).toHaveLength(4);
    expect(brittle).toEqual([1, 3]);
    expect(steps[1].locator).toEqual({ by: "css", value: "#email-x82a" });
  });

  it("parses toHaveValue and toContainText assertions", () => {
    const script = `
      await expect(page.getByLabel('Email')).toHaveValue('a@b.com');
      await expect(page.getByTestId('toast')).toContainText('Saved');
    `;
    const { steps } = parseCodegen(script);
    expect(steps).toEqual([
      { action: "expect_value", locator: { by: "label", value: "Email" }, value: "a@b.com" },
      { action: "expect_text", locator: { by: "testid", value: "toast" }, value: "Saved" },
    ]);
  });

  it("treats check/dblclick as click", () => {
    const { steps } = parseCodegen("await page.getByRole('checkbox', { name: 'Agree' }).check();");
    expect(steps[0]).toEqual({
      action: "click",
      locator: { by: "role", role: "checkbox", name: "Agree" },
    });
  });

  it("records unsupported actions as unparsed rather than dropping silently", () => {
    const script = `
      await page.getByRole('textbox').press('Enter');
      await page.getByLabel('Country').selectOption('US');
    `;
    const { steps, unparsed } = parseCodegen(script);
    expect(steps).toEqual([]);
    expect(unparsed).toHaveLength(2);
  });
});
