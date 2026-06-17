import { describe, it, expect } from "vitest";
import { interpolate, specVars } from "./vars";

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
