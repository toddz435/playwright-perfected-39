import { describe, it, expect } from "vitest";
import { conditionLabel, CONDITION_KINDS, URL_CONDITION_KINDS } from "./conditions";

describe("conditionLabel", () => {
  it("labels element conditions with the locator", () => {
    expect(conditionLabel({ kind: "visible", target: "#cookie-accept" })).toBe(
      "only if visible: #cookie-accept",
    );
    expect(conditionLabel({ kind: "not_exists", target: ".modal" })).toBe(
      "only if not exists: .modal",
    );
  });

  it("labels url_contains against the URL substring, not a locator", () => {
    expect(conditionLabel({ kind: "url_contains", target: "/checkout" })).toBe(
      'only if url contains "/checkout"',
    );
  });

  it("prefers a structured locator label when present", () => {
    expect(
      conditionLabel({ kind: "visible", locator: { by: "role", role: "button", name: "OK" } }),
    ).toContain("only if visible:");
  });

  it("every kind has a label and url kinds are a subset", () => {
    for (const kind of CONDITION_KINDS) {
      expect(conditionLabel({ kind, target: "x" })).toMatch(/^only if /);
    }
    expect([...URL_CONDITION_KINDS].every((k) => CONDITION_KINDS.includes(k))).toBe(true);
  });
});
