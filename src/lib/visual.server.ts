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

// Per-run capture file names look like `{captureId}-{idx}-actual.png` / `...-diff.png` /
// `...-baseline.png` (the snapshot of the baseline that run compared against), with an optional
// `-i{n}` iteration segment for screenshots inside a loop (e.g. `{captureId}-{idx}-i2-actual.png`).
// captureId is a UUID (so it contains hyphens) — strip the trailing
// `-{idx}[-i{n}]-(actual|diff|baseline).png` to recover it. Returns null for anything that isn't a
// capture file (e.g. the live baseline at the test root).
function captureIdOf(name: string): string | null {
  const m = name.match(/^(.*)-\d+(?:-i\d+)?-(?:actual|diff|baseline)\.png$/);
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

// From a Storage list() page, the names that are real files. Folder/prefix entries come back with
// a null `id`, so they're excluded (we never want to pass a prefix to remove()).
export function storageFileNames(
  entries: { name: string; id?: string | null }[] | null | undefined,
): string[] {
  return (entries ?? []).filter((e) => e && e.id != null).map((e) => e.name);
}

// Full object paths to remove for a test: its baseline files (directly under {owner}/{testId}) and
// its per-run capture files (under {owner}/{testId}/captures). Pure → unit-testable.
export function storageObjectPaths(
  rootFiles: string[],
  captureFiles: string[],
  owner: string,
  testId: string,
): string[] {
  const base = `${owner}/${testId}`;
  return [
    ...rootFiles.map((n) => `${base}/${n}`),
    ...captureFiles.map((n) => `${base}/captures/${n}`),
  ];
}

// Remove ALL of a test's visual-regression objects (baselines + captures) from the screenshots
// bucket, so deleting a test/project doesn't orphan images. Best-effort — callers must not let a
// Storage hiccup block the DB delete. `bucket` is a Supabase Storage handle (storage.from(...)).
// Returns how many objects were removed. (Retention keeps captures small, so one 1000-entry list
// page per level is ample.)
export async function purgeTestStorage(
  bucket: any,
  owner: string,
  testId: string,
): Promise<number> {
  const base = `${owner}/${testId}`;
  const [root, caps] = await Promise.all([
    bucket.list(base, { limit: 1000 }),
    bucket.list(`${base}/captures`, { limit: 1000 }),
  ]);
  const paths = storageObjectPaths(
    storageFileNames(root?.data),
    storageFileNames(caps?.data),
    owner,
    testId,
  );
  if (paths.length) await bucket.remove(paths);
  return paths.length;
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
