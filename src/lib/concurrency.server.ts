// Server-only in-memory concurrency limiter. Caps how many heavy operations (recordings spawn
// a headed browser for up to 15 min; runs spawn a headless browser) a single user — and the
// whole runner — can have in flight at once, so one user can't exhaust the machine (DoS).
//
// In-memory state is correct for the single Node runner this currently targets. A multi-
// instance deployment would need shared state (e.g. Redis) for a true global cap — revisit
// with the production-runner work.

export class ConcurrencyError extends Error {}

export type Limits = { perUser: number; global: number };

// Defaults. Recorder is the heavy one (headed browser, long-lived); runs are short.
export const RECORDER_LIMITS: Limits = { perUser: 1, global: 3 };
export const RUN_LIMITS: Limits = { perUser: 3, global: 10 };

// Runs `fn` over all items with at most `concurrency` in flight at once, preserving result
// order. A bounded worker pool: workers pull from a shared cursor until the list is drained.
// Used to run a batch of tests in parallel without firing them all at once.
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

const perUser = new Map<string, number>(); // `${bucket}:${userId}` → count
const perBucket = new Map<string, number>(); // `${bucket}` → count

// Reserves a slot for (bucket, userId). Throws ConcurrencyError if the per-user or global cap
// is already reached. Returns an idempotent release() the caller MUST invoke (in a finally)
// when the operation finishes — on success, error, timeout, or disconnect.
export function acquireSlot(bucket: string, userId: string, limits: Limits): () => void {
  const uKey = `${bucket}:${userId}`;
  const g = perBucket.get(bucket) ?? 0;
  if (g >= limits.global)
    throw new ConcurrencyError(`The runner is at capacity for ${bucket}s — try again shortly.`);
  const u = perUser.get(uKey) ?? 0;
  if (u >= limits.perUser)
    throw new ConcurrencyError(
      `You already have ${u} ${bucket}${u === 1 ? "" : "s"} in progress — wait for it to finish.`,
    );

  perBucket.set(bucket, g + 1);
  perUser.set(uKey, u + 1);

  let released = false;
  return () => {
    if (released) return; // idempotent — safe to call from multiple cleanup paths
    released = true;
    const nb = (perBucket.get(bucket) ?? 1) - 1;
    if (nb <= 0) perBucket.delete(bucket);
    else perBucket.set(bucket, nb);
    const nu = (perUser.get(uKey) ?? 1) - 1;
    if (nu <= 0) perUser.delete(uKey);
    else perUser.set(uKey, nu);
  };
}
