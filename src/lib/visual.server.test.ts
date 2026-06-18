import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { compareVisual } from "./visual.server";

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
