import { describe, it, expect } from "vitest";
import { toAdf, buildTicketFromRun } from "./jira.server";

describe("toAdf", () => {
  it("makes one paragraph per non-empty line", () => {
    const doc = toAdf("line one\n\nline two");
    expect(doc).toEqual({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "line one" }] },
        { type: "paragraph", content: [{ type: "text", text: "line two" }] },
      ],
    });
  });
  it("never produces an empty content array (Jira rejects empty docs)", () => {
    const doc = toAdf("");
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].content[0].text).toBe(" ");
  });
});

describe("buildTicketFromRun", () => {
  it("summarizes the failing step and includes the error in the description", () => {
    const test = { id: "t1", name: "Checkout flow" };
    const run = {
      id: "r1",
      status: "failed",
      steps: [
        { action: "goto", target: "https://x.com", status: "passed" },
        { action: "click", locator: { by: "role", role: "button", name: "Pay" }, status: "failed", error: "locator not found" },
      ],
    };
    const { summary, description } = buildTicketFromRun(test, run);
    expect(summary).toContain("[Testrify] Checkout flow failed");
    expect(summary).toContain("click");
    expect(description).toContain("Test: Checkout flow");
    expect(description).toContain("Run: r1 · status: failed");
    expect(description).toContain("Error: locator not found");
    expect(description).toContain("Filed automatically by Testrify.");
  });
  it("handles a run with no failed step / missing fields", () => {
    const { summary, description } = buildTicketFromRun({ name: "T" }, { id: "r", status: "passed", steps: [] });
    expect(summary).toBe("[Testrify] T failed");
    expect(description).toContain("Run: r · status: passed");
  });
  it("caps the summary length", () => {
    const { summary } = buildTicketFromRun({ name: "x".repeat(400) }, { steps: [] });
    expect(summary.length).toBeLessThanOrEqual(250);
  });
});
