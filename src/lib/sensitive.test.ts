import { describe, it, expect } from "vitest";
import { isSensitiveFill, redactSensitiveFills, SENSITIVE_RE } from "./sensitive";

describe("isSensitiveFill", () => {
  it("flags fills into password/secret-ish fields", () => {
    expect(isSensitiveFill({ action: "fill", locator: { by: "label", value: "Password" }, value: "x" })).toBe(true);
    expect(isSensitiveFill({ action: "fill", locator: { by: "role", role: "textbox", name: "API Key" }, value: "x" })).toBe(true);
    expect(isSensitiveFill({ action: "fill", locator: { by: "placeholder", value: "Enter your PIN" }, value: "x" })).toBe(true);
  });

  it("ignores non-sensitive fields, non-fill actions, and empty values", () => {
    expect(isSensitiveFill({ action: "fill", locator: { by: "label", value: "Email" }, value: "a@b.com" })).toBe(false);
    expect(isSensitiveFill({ action: "click", locator: { by: "label", value: "Password" } })).toBe(false);
    expect(isSensitiveFill({ action: "fill", locator: { by: "label", value: "Password" }, value: "" })).toBe(false);
  });

  it("SENSITIVE_RE matches the documented keywords", () => {
    for (const w of ["password", "secret", "token", "api key", "otp", "cvv", "ssn", "credit card", "pin"])
      expect(SENSITIVE_RE.test(w)).toBe(true);
    expect(SENSITIVE_RE.test("username")).toBe(false);
  });
});

describe("redactSensitiveFills", () => {
  it("rewrites a password fill to {{var}} and drops the literal", () => {
    const { steps, secretNames } = redactSensitiveFills([
      { action: "goto", target: "https://app/login" },
      { action: "fill", locator: { by: "label", value: "Email" }, value: "ada@x.com" },
      { action: "fill", locator: { by: "label", value: "Password" }, value: "s3cret!" },
    ]);
    expect(secretNames).toHaveLength(1);
    // the literal never survives anywhere
    expect(JSON.stringify(steps)).not.toContain("s3cret");
    expect(steps[2].value).toBe(`{{${secretNames[0]}}}`);
    // non-sensitive fields untouched
    expect(steps[1].value).toBe("ada@x.com");
    expect(steps[0].target).toBe("https://app/login");
  });

  it("uniquifies names across multiple secret fields", () => {
    const { steps, secretNames } = redactSensitiveFills([
      { action: "fill", locator: { by: "label", value: "Password" }, value: "a" },
      { action: "fill", locator: { by: "label", value: "Password" }, value: "b" },
    ]);
    expect(new Set(secretNames).size).toBe(2); // distinct
    expect(steps[0].value).toBe(`{{${secretNames[0]}}}`);
    expect(steps[1].value).toBe(`{{${secretNames[1]}}}`);
  });

  it("returns the steps unchanged when nothing is sensitive", () => {
    const input = [
      { action: "fill", locator: { by: "label" as const, value: "Search" }, value: "shoes" },
    ];
    const { steps, secretNames } = redactSensitiveFills(input);
    expect(secretNames).toEqual([]);
    expect(steps).toBe(input); // same reference (no work done)
  });
});
