import { describe, it, expect } from "vitest";
import { interpolate, specVars, secretValues, maskSecrets, SECRET_MASK } from "./vars";

describe("secretValues + maskSecrets", () => {
  const spec = {
    variables: { password: "hunter2", baseUrl: "https://a.com" },
    secrets: ["password"],
  };

  it("secretValues returns only the non-empty secret-flagged values", () => {
    expect(secretValues(spec)).toEqual(["hunter2"]);
    expect(secretValues({ variables: { a: "1" }, secrets: ["missing"] })).toEqual([]);
    expect(secretValues({})).toEqual([]);
  });

  it("masks secret values in nested run-result structures", () => {
    const steps = [
      { action: "fill", target: "input#pw", value: "hunter2" },
      { action: "goto", target: "https://a.com/login" }, // non-secret stays
    ];
    expect(maskSecrets(steps, secretValues(spec))).toEqual([
      { action: "fill", target: "input#pw", value: SECRET_MASK },
      { action: "goto", target: "https://a.com/login" },
    ]);
  });

  it("is a no-op when there are no secrets", () => {
    const v = { value: "hunter2" };
    expect(maskSecrets(v, [])).toEqual(v);
  });
});

describe("interpolate", () => {
  it("replaces {{name}} in strings (with optional spaces)", () => {
    expect(interpolate("{{baseUrl}}/login", { baseUrl: "https://a.com" })).toBe(
      "https://a.com/login",
    );
    expect(interpolate("hi {{ name }}", { name: "Sam" })).toBe("hi Sam");
  });

  it("leaves unknown variables untouched", () => {
    expect(interpolate("{{missing}}/x", { other: "1" })).toBe("{{missing}}/x");
  });

  it("does not resolve inherited Object keys (constructor/toString/__proto__)", () => {
    expect(interpolate("{{constructor}}", {})).toBe("{{constructor}}");
    expect(interpolate("{{toString}}", {})).toBe("{{toString}}");
    expect(interpolate("{{__proto__}}", {})).toBe("{{__proto__}}");
  });

  it("recurses into arrays and objects (e.g. steps)", () => {
    const steps = [
      { action: "goto", target: "{{baseUrl}}/login" },
      { action: "fill", locator: { by: "label", value: "Email" }, value: "{{user}}" },
    ];
    expect(interpolate(steps, { baseUrl: "https://a.com", user: "sam@a.com" })).toEqual([
      { action: "goto", target: "https://a.com/login" },
      { action: "fill", locator: { by: "label", value: "Email" }, value: "sam@a.com" },
    ]);
  });

  it("leaves non-strings (numbers, booleans, null) alone", () => {
    expect(interpolate({ a: 1, b: true, c: null }, {})).toEqual({ a: 1, b: true, c: null });
  });

  it("does not mutate the input", () => {
    const input = { target: "{{x}}" };
    interpolate(input, { x: "Y" });
    expect(input.target).toBe("{{x}}");
  });
});

describe("specVars", () => {
  it("normalizes a variables map to strings", () => {
    expect(specVars({ variables: { a: "1", n: 2 } })).toEqual({ a: "1", n: "2" });
  });
  it("returns {} for missing/malformed variables", () => {
    expect(specVars({})).toEqual({});
    expect(specVars({ variables: ["x"] })).toEqual({});
    expect(specVars(null)).toEqual({});
  });
});
