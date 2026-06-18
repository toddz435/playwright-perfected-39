import { describe, it, expect } from "vitest";
import { validateBlocks, computeDepths, blockBounds, isBlockMarker } from "./blocks";

const S = (...actions: string[]) => actions.map((action) => ({ action }));

describe("validateBlocks", () => {
  it("accepts balanced blocks (incl. nested + else)", () => {
    expect(validateBlocks(S("goto", "if", "click", "else", "click", "endif"))).toBeNull();
    expect(validateBlocks(S("if", "if", "click", "endif", "endif"))).toBeNull();
    expect(validateBlocks(S("click", "click"))).toBeNull();
  });
  it("rejects an if with no endif", () => {
    expect(validateBlocks(S("if", "click"))).toMatch(/missing an "endif"/);
  });
  it("rejects an endif with no if", () => {
    expect(validateBlocks(S("click", "endif"))).toMatch(/no matching "if"/);
  });
  it("rejects else outside a block and duplicate else", () => {
    expect(validateBlocks(S("else"))).toMatch(/outside an if-block/);
    expect(validateBlocks(S("if", "else", "else", "endif"))).toMatch(/only one "else"/);
  });
});

describe("computeDepths", () => {
  it("indents the body and dedents markers", () => {
    // goto, if, click, else, click, endif
    expect(computeDepths(S("goto", "if", "click", "else", "click", "endif"))).toEqual([
      0, 0, 1, 0, 1, 0,
    ]);
  });
  it("handles nesting", () => {
    // if, if, click, endif, endif
    expect(computeDepths(S("if", "if", "click", "endif", "endif"))).toEqual([0, 1, 2, 1, 0]);
  });
});

describe("blockBounds", () => {
  const steps = S("goto", "if", "click", "else", "click", "endif");
  it("resolves from the if, the else, and the endif markers", () => {
    expect(blockBounds(steps, 1)).toEqual({ ifIndex: 1, elseIndex: 3, endifIndex: 5 });
    expect(blockBounds(steps, 3)).toEqual({ ifIndex: 1, elseIndex: 3, endifIndex: 5 });
    expect(blockBounds(steps, 5)).toEqual({ ifIndex: 1, elseIndex: 3, endifIndex: 5 });
  });
  it("returns null for a non-marker", () => {
    expect(blockBounds(steps, 0)).toBeNull();
    expect(blockBounds(steps, 2)).toBeNull();
  });
  it("picks the correct (inner) block when nested", () => {
    const nested = S("if", "if", "click", "endif", "endif");
    expect(blockBounds(nested, 1)).toEqual({ ifIndex: 1, elseIndex: null, endifIndex: 3 });
    expect(blockBounds(nested, 0)).toEqual({ ifIndex: 0, elseIndex: null, endifIndex: 4 });
  });
});

describe("isBlockMarker", () => {
  it("identifies markers", () => {
    expect(["if", "else", "endif"].every(isBlockMarker)).toBe(true);
    expect(["click", "goto", "screenshot"].some(isBlockMarker)).toBe(false);
  });
});
