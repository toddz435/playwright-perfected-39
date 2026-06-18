import { describe, it, expect } from "vitest";
import { validateBlocks, computeDepths, blockBounds, loopBounds, isBlockMarker } from "./blocks";

const S = (...actions: string[]) => actions.map((action) => ({ action }));

describe("validateBlocks", () => {
  it("accepts balanced if/else/repeat (incl. nested + interleaved)", () => {
    expect(validateBlocks(S("goto", "if", "click", "else", "click", "endif"))).toBeNull();
    expect(validateBlocks(S("if", "if", "click", "endif", "endif"))).toBeNull();
    expect(validateBlocks(S("repeat", "click", "endrepeat"))).toBeNull();
    expect(validateBlocks(S("if", "repeat", "click", "endrepeat", "endif"))).toBeNull();
    expect(validateBlocks(S("repeat", "if", "click", "endif", "endrepeat"))).toBeNull();
    expect(validateBlocks(S("click", "click"))).toBeNull();
  });
  it("rejects an opener with no closer", () => {
    expect(validateBlocks(S("if", "click"))).toMatch(/missing their end marker/);
    expect(validateBlocks(S("repeat", "click"))).toMatch(/missing their end marker/);
  });
  it("rejects an end marker with no opener", () => {
    expect(validateBlocks(S("click", "endif"))).toMatch(/no matching "if"/);
    expect(validateBlocks(S("click", "endrepeat"))).toMatch(/no matching "repeat"/);
  });
  it("rejects crossed nesting", () => {
    expect(validateBlocks(S("if", "repeat", "endif", "endrepeat"))).toMatch(/no matching "if"/);
  });
  it("rejects else outside a block and duplicate else", () => {
    expect(validateBlocks(S("else"))).toMatch(/outside an if-block/);
    expect(validateBlocks(S("if", "else", "else", "endif"))).toMatch(/only one "else"/);
    expect(validateBlocks(S("repeat", "else", "endrepeat"))).toMatch(/outside an if-block/);
  });
});

describe("computeDepths", () => {
  it("indents if and repeat bodies and dedents markers", () => {
    expect(computeDepths(S("goto", "if", "click", "else", "click", "endif"))).toEqual([
      0, 0, 1, 0, 1, 0,
    ]);
    expect(computeDepths(S("repeat", "click", "endrepeat"))).toEqual([0, 1, 0]);
    expect(computeDepths(S("if", "repeat", "click", "endrepeat", "endif"))).toEqual([
      0, 1, 2, 1, 0,
    ]);
  });
});

describe("blockBounds", () => {
  const steps = S("goto", "if", "click", "else", "click", "endif");
  it("resolves from the if, the else, and the endif markers", () => {
    expect(blockBounds(steps, 1)).toEqual({ ifIndex: 1, elseIndex: 3, endifIndex: 5 });
    expect(blockBounds(steps, 3)).toEqual({ ifIndex: 1, elseIndex: 3, endifIndex: 5 });
    expect(blockBounds(steps, 5)).toEqual({ ifIndex: 1, elseIndex: 3, endifIndex: 5 });
  });
  it("returns null for a non-if-marker", () => {
    expect(blockBounds(steps, 0)).toBeNull();
    expect(blockBounds(steps, 2)).toBeNull();
  });
});

describe("loopBounds", () => {
  it("resolves from the repeat and endrepeat markers, incl. nested", () => {
    const steps = S("goto", "repeat", "click", "endrepeat");
    expect(loopBounds(steps, 1)).toEqual({ repeatIndex: 1, endrepeatIndex: 3 });
    expect(loopBounds(steps, 3)).toEqual({ repeatIndex: 1, endrepeatIndex: 3 });
    const nested = S("repeat", "repeat", "click", "endrepeat", "endrepeat");
    expect(loopBounds(nested, 1)).toEqual({ repeatIndex: 1, endrepeatIndex: 3 });
    expect(loopBounds(nested, 0)).toEqual({ repeatIndex: 0, endrepeatIndex: 4 });
  });
  it("returns null for a non-loop-marker", () => {
    expect(loopBounds(S("goto", "repeat", "endrepeat"), 0)).toBeNull();
  });
});

describe("isBlockMarker", () => {
  it("identifies all five markers", () => {
    expect(["if", "else", "endif", "repeat", "endrepeat"].every(isBlockMarker)).toBe(true);
    expect(["click", "goto", "screenshot"].some(isBlockMarker)).toBe(false);
  });
});
