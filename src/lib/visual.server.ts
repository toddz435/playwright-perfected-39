// Server-only image diff for visual regression. Decodes two PNG buffers and pixel-diffs
// them with pixelmatch. Dynamic imports keep pngjs/pixelmatch out of the Cloudflare bundle.
export type VisualDiff = {
  dimsMatch: boolean;
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number; // fraction of pixels that differ (0..1); 1 when dimensions changed
  diffPng?: Buffer; // diff visualization (only when dimensions match)
};

// `colorThreshold` is pixelmatch's per-pixel sensitivity (0..1). The pass/fail decision on
// diffRatio is made by the caller.
export async function compareVisual(
  baseline: Buffer,
  actual: Buffer,
  colorThreshold = 0.1,
): Promise<VisualDiff> {
  const { PNG } = await import("pngjs");
  const pixelmatch = (await import("pixelmatch")).default;

  const a = PNG.sync.read(baseline);
  const b = PNG.sync.read(actual);
  const totalPixels = b.width * b.height;

  // A size change is itself a visual change — report it without pixel-diffing.
  if (a.width !== b.width || a.height !== b.height) {
    return {
      dimsMatch: false,
      width: b.width,
      height: b.height,
      diffPixels: 0,
      totalPixels,
      diffRatio: 1,
    };
  }

  const { width, height } = a;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: colorThreshold,
  });
  return {
    dimsMatch: true,
    width,
    height,
    diffPixels,
    totalPixels,
    diffRatio: totalPixels ? diffPixels / totalPixels : 0,
    diffPng: PNG.sync.write(diff),
  };
}
