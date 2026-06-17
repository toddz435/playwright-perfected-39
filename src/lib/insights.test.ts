import { describe, it, expect } from "vitest";
import { flakyHotspots, runStats } from "./insights";

const runs = [
  // newest first
  {
    test_id: "t1",
    status: "passed",
    steps: [
      { status: "healed", healed_from: "#login-x1", healed_to: "label=Email", recovery: "ai" },
      { status: "passed" },
    ],
  },
  {
    test_id: "t1",
    status: "passed",
    steps: [
      { status: "healed", healed_from: "#login-x1", healed_to: "#login-old", recovery: "fallback" },
    ],
  },
  {
    test_id: "t2",
    status: "failed",
    steps: [{ status: "failed", error: "x" }],
  },
];

describe("flakyHotspots", () => {
  it("aggregates heals by test + broken locator, newest fix first", () => {
    const hot = flakyHotspots(runs);
    expect(hot).toHaveLength(1);
    expect(hot[0]).toEqual({
      testId: "t1",
      locator: "#login-x1",
      heals: 2,
      fallback: 1,
      ai: 1,
      lastHealedTo: "label=Email", // from the newest run
    });
  });

  it("returns empty when nothing healed", () => {
    expect(flakyHotspots([{ test_id: "t", status: "passed", steps: [{ status: "passed" }] }])).toEqual(
      [],
    );
  });
});

describe("runStats", () => {
  it("counts pass/fail/heals across runs", () => {
    expect(runStats(runs)).toEqual({
      total: 3,
      passed: 2,
      failed: 1,
      heals: 2,
      runsWithHeals: 2,
    });
  });
});
