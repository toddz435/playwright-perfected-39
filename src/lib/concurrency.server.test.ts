import { describe, it, expect } from "vitest";
import { acquireSlot, ConcurrencyError, mapPool } from "./concurrency.server";

describe("acquireSlot", () => {
  const L = { perUser: 2, global: 3 };

  it("allows up to perUser, then throws", () => {
    const r1 = acquireSlot("b1", "u1", L);
    const r2 = acquireSlot("b1", "u1", L);
    expect(() => acquireSlot("b1", "u1", L)).toThrow(ConcurrencyError);
    r1();
    r2();
  });

  it("releasing frees a slot", () => {
    const r1 = acquireSlot("b2", "u1", L);
    acquireSlot("b2", "u1", L);
    expect(() => acquireSlot("b2", "u1", L)).toThrow(); // at perUser=2
    r1();
    const r3 = acquireSlot("b2", "u1", L); // freed → ok
    r3();
  });

  it("enforces the global cap across different users", () => {
    const rs = [
      acquireSlot("b3", "a", L),
      acquireSlot("b3", "b", L),
      acquireSlot("b3", "c", L),
    ];
    expect(() => acquireSlot("b3", "d", L)).toThrow(/capacity/i); // global=3 reached
    rs.forEach((r) => r());
  });

  it("release is idempotent (double-release doesn't under-count)", () => {
    const r = acquireSlot("b4", "u1", L);
    r();
    r(); // no-op
    // Two fresh slots should both succeed (count is at 0, not -1).
    const a = acquireSlot("b4", "u1", L);
    const b = acquireSlot("b4", "u1", L);
    expect(() => acquireSlot("b4", "u1", L)).toThrow();
    a();
    b();
  });

  it("buckets and users are independent", () => {
    const r1 = acquireSlot("rec", "u1", { perUser: 1, global: 9 });
    expect(() => acquireSlot("rec", "u1", { perUser: 1, global: 9 })).toThrow(); // same bucket+user
    const r2 = acquireSlot("rec", "u2", { perUser: 1, global: 9 }); // different user → ok
    const r3 = acquireSlot("run", "u1", { perUser: 1, global: 9 }); // different bucket → ok
    r1();
    r2();
    r3();
  });
});

describe("mapPool", () => {
  it("returns results in input order regardless of completion timing", async () => {
    const out = await mapPool([10, 5, 1], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i; // index → confirms order
    });
    expect(out).toEqual([0, 1, 2]);
  });

  it("never exceeds the concurrency limit in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles empty input and concurrency >= length", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
    expect(await mapPool([1, 2], 9, async (x) => x * 2)).toEqual([2, 4]);
  });
});
