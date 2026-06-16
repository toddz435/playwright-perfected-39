import { describe, it, expect } from "vitest";
import { applyRecoveries } from "./recovery";

describe("applyRecoveries", () => {
  it("promotes a structured fallback to primary and removes it from fallbacks", () => {
    const steps = [
      {
        action: "click",
        locator: { by: "css" as const, value: "#old" },
        fallbacks: [
          { by: "role" as const, role: "button", name: "Login" },
          { by: "css" as const, value: "#alt" },
        ],
      },
    ];
    const { steps: out, changed } = applyRecoveries(steps, [
      { idx: 0, recovery: "fallback", new_locator: { by: "role", role: "button", name: "Login" } },
    ]);
    expect(changed).toBe(1);
    expect(out[0].locator).toEqual({ by: "role", role: "button", name: "Login" });
    expect(out[0].target).toBeUndefined();
    expect(out[0].fallbacks).toEqual([{ by: "css", value: "#alt" }]);
  });

  it("stores an AI-healed string as the target and clears the structured locator", () => {
    const steps = [{ action: "fill", locator: { by: "css" as const, value: "#broken" } }];
    const { steps: out, changed } = applyRecoveries(steps, [
      { idx: 0, recovery: "ai", new_locator: "input#password" },
    ]);
    expect(changed).toBe(1);
    expect(out[0].target).toBe("input#password");
    expect(out[0].locator).toBeUndefined();
  });

  it("leaves steps without a recovery untouched", () => {
    const steps = [
      { action: "goto", target: "https://x.com" },
      { action: "click", locator: { by: "css" as const, value: "#a" } },
    ];
    const { steps: out, changed } = applyRecoveries(steps, [
      { idx: 1 }, // passed normally — no recovery
    ]);
    expect(changed).toBe(0);
    expect(out).toEqual(steps);
  });

  it("ignores out-of-range or malformed results", () => {
    const steps = [{ action: "click", locator: { by: "css" as const, value: "#a" } }];
    const { changed } = applyRecoveries(steps, [
      { idx: 9, recovery: "ai", new_locator: "x" },
      { idx: 0, recovery: "fallback" }, // missing new_locator
    ]);
    expect(changed).toBe(0);
  });
});
