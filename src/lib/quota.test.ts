import { describe, it, expect } from "vitest";
import { quotaStatus, planLimit, monthStartISO, FREE_MONTHLY_RUNS } from "./quota";

describe("planLimit", () => {
  it("defaults unknown/empty plans to the free limit", () => {
    expect(planLimit(undefined)).toBe(FREE_MONTHLY_RUNS);
    expect(planLimit(null)).toBe(FREE_MONTHLY_RUNS);
    expect(planLimit("garbage")).toBe(FREE_MONTHLY_RUNS);
    expect(planLimit("free")).toBe(FREE_MONTHLY_RUNS);
  });
  it("treats pro as unlimited", () => {
    expect(planLimit("pro")).toBe(Infinity);
  });
});

describe("quotaStatus", () => {
  it("reports remaining + not-over under the free limit", () => {
    const s = quotaStatus(40, "free");
    expect(s).toMatchObject({ used: 40, limit: 100, remaining: 60, over: false, unlimited: false });
  });
  it("is over at and beyond the limit", () => {
    expect(quotaStatus(100, "free").over).toBe(true);
    expect(quotaStatus(100, "free").remaining).toBe(0);
    expect(quotaStatus(140, "free")).toMatchObject({ over: true, remaining: 0 });
  });
  it("never goes negative or fractional", () => {
    expect(quotaStatus(-5, "free").used).toBe(0);
    expect(quotaStatus(3.9, "free").used).toBe(3);
  });
  it("pro is unlimited (never over)", () => {
    const s = quotaStatus(5000, "pro");
    expect(s.unlimited).toBe(true);
    expect(s.over).toBe(false);
    expect(s.remaining).toBe(Infinity);
  });
});

describe("monthStartISO", () => {
  it("returns the 1st of the current UTC month at midnight", () => {
    expect(monthStartISO(new Date("2026-06-22T16:30:00Z"))).toBe("2026-06-01T00:00:00.000Z");
    expect(monthStartISO(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
  });
});
