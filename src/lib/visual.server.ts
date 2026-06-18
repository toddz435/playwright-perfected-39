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

// Per-run capture file names look like `{captureId}-{idx}-actual.png` / `...-diff.png`.
// captureId is a UUID (so it contains hyphens) — strip the trailing `-{idx}-(actual|diff).png`
// to recover it. Returns null for anything that isn't a capture file (e.g. a baseline).
function captureIdOf(name: string): string | null {
  const m = name.match(/^(.*)-\d+-(?:actual|diff)\.png$/);
  return m ? m[1] : null;
}

// Given capture file names ordered NEWEST-FIRST, return the names belonging to runs beyond
// the most recent `keepRuns` (grouped by captureId = one run). Pure so it can be unit-tested
// without Storage. Non-capture names are ignored (never deleted).
export function selectExpiredCaptures(namesNewestFirst: string[], keepRuns: number): string[] {
  const keep = new Set<string>();
  for (const n of namesNewestFirst) {
    const cid = captureIdOf(n);
    if (cid && !keep.has(cid)) {
      if (keep.size >= keepRuns) break; // every later distinct run is older → expired
      keep.add(cid);
    }
  }
  return namesNewestFirst.filter((n) => {
    const cid = captureIdOf(n);
    return cid !== null && !keep.has(cid);
  });
}

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
