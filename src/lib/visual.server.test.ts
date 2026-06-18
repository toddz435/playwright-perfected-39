import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { compareVisual, selectExpiredCaptures } from "./visual.server";

// Builds a solid-color w×h PNG buffer.
function solid(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

describe("compareVisual", () => {
  it("reports zero diff for identical images", async () => {
    const img = solid(4, 4, [255, 0, 0, 255]);
    const r = await compareVisual(img, img);
    expect(r.dimsMatch).toBe(true);
    expect(r.diffPixels).toBe(0);
    expect(r.diffRatio).toBe(0);
    expect(r.diffPng).toBeInstanceOf(Buffer);
  });

  it("detects changed pixels", async () => {
    const base = solid(4, 4, [255, 0, 0, 255]);
    const changed = PNG.sync.read(solid(4, 4, [255, 0, 0, 255]));
    changed.data[0] = 0; // flip one pixel's red channel to fully different
    changed.data[1] = 255;
    const r = await compareVisual(base, PNG.sync.write(changed));
    expect(r.dimsMatch).toBe(true);
    expect(r.diffPixels).toBeGreaterThan(0);
    expect(r.diffRatio).toBeCloseTo(r.diffPixels / 16);
  });

  it("flags a dimension change as a full diff", async () => {
    const r = await compareVisual(solid(4, 4, [0, 0, 0, 255]), solid(8, 8, [0, 0, 0, 255]));
    expect(r.dimsMatch).toBe(false);
    expect(r.diffRatio).toBe(1);
    expect(r.diffPng).toBeUndefined();
  });
});

describe("selectExpiredCaptures", () => {
  // Newest-first capture names; captureId is a UUID (contains hyphens).
  const run = (id: string, steps = 1) =>
    Array.from({ length: steps }, (_, i) => [`${id}-${i}-actual.png`, `${id}-${i}-diff.png`]).flat();
  const cap = (n: number) => `11111111-1111-1111-1111-${String(n).padStart(12, "0")}`;

  it("keeps the most recent N runs and expires the rest", () => {
    // 5 runs, newest first; keep 2 → runs 3,4,5 (6 files) expire.
    const names = [cap(5), cap(4), cap(3), cap(2), cap(1)].flatMap((id) => run(id));
    const expired = selectExpiredCaptures(names, 2);
    expect(expired).toHaveLength(6);
    expect(expired.every((n) => [cap(3), cap(2), cap(1)].some((id) => n.startsWith(id)))).toBe(true);
    expect(expired.some((n) => n.startsWith(cap(5)) || n.startsWith(cap(4)))).toBe(false);
  });

  it("expires nothing when runs are within the window", () => {
    const names = [cap(2), cap(1)].flatMap((id) => run(id, 2));
    expect(selectExpiredCaptures(names, 5)).toEqual([]);
  });

  it("groups multi-screenshot runs by captureId (one run = one unit)", () => {
    // Each run has 2 screenshot steps (4 files). Keep 1 run → the older run's 4 files expire.
    const names = [...run(cap(2), 2), ...run(cap(1), 2)];
    const expired = selectExpiredCaptures(names, 1);
    expect(expired).toHaveLength(4);
    expect(expired.every((n) => n.startsWith(cap(1)))).toBe(true);
  });

  it("never selects non-capture files (e.g. baselines)", () => {
    const names = ["sid-abc.png", "baseline-0.png", ...run(cap(1))];
    const expired = selectExpiredCaptures(names, 0);
    expect(expired).toEqual([`${cap(1)}-0-actual.png`, `${cap(1)}-0-diff.png`]);
    expect(expired).not.toContain("sid-abc.png");
    expect(expired).not.toContain("baseline-0.png");
  });
});
