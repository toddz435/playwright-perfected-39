import { describe, it, expect } from "vitest";
import { matches, isDue } from "./cron";

describe("matches", () => {
  it("wildcard matches any value", () => {
    expect(matches("*", 0)).toBe(true);
    expect(matches("*", 59)).toBe(true);
  });

  it("exact value match", () => {
    expect(matches("5", 5)).toBe(true);
    expect(matches("5", 6)).toBe(false);
  });

  it("range match (A-B)", () => {
    expect(matches("1-5", 1)).toBe(true);
    expect(matches("1-5", 3)).toBe(true);
    expect(matches("1-5", 5)).toBe(true);
    expect(matches("1-5", 0)).toBe(false);
    expect(matches("1-5", 6)).toBe(false);
  });

  it("step match (*/N)", () => {
    expect(matches("*/5", 0)).toBe(true);
    expect(matches("*/5", 5)).toBe(true);
    expect(matches("*/5", 10)).toBe(true);
    expect(matches("*/5", 3)).toBe(false);
  });

  it("step with base (N/M)", () => {
    expect(matches("2/3", 2)).toBe(true);
    expect(matches("2/3", 5)).toBe(true);
    expect(matches("2/3", 8)).toBe(true);
    expect(matches("2/3", 3)).toBe(false);
    expect(matches("2/3", 1)).toBe(false);
  });

  it("comma-separated list", () => {
    expect(matches("1,3,5", 1)).toBe(true);
    expect(matches("1,3,5", 3)).toBe(true);
    expect(matches("1,3,5", 5)).toBe(true);
    expect(matches("1,3,5", 2)).toBe(false);
  });

  it("mixed comma-separated with ranges", () => {
    expect(matches("1-3,7,10-12", 2)).toBe(true);
    expect(matches("1-3,7,10-12", 7)).toBe(true);
    expect(matches("1-3,7,10-12", 11)).toBe(true);
    expect(matches("1-3,7,10-12", 5)).toBe(false);
  });
});

describe("isDue", () => {
  it("returns true for every-minute cron", () => {
    const now = new Date("2025-06-01T10:30:00Z");
    expect(isDue("* * * * *", now)).toBe(true);
  });

  it("matches a specific minute and hour", () => {
    const now = new Date("2025-06-01T14:30:00Z");
    expect(isDue("30 14 * * *", now)).toBe(true);
    expect(isDue("31 14 * * *", now)).toBe(false);
  });

  it("matches day of month", () => {
    const now = new Date("2025-06-15T00:00:00Z");
    expect(isDue("0 0 15 * *", now)).toBe(true);
    expect(isDue("0 0 16 * *", now)).toBe(false);
  });

  it("matches month", () => {
    const now = new Date("2025-03-01T00:00:00Z");
    expect(isDue("0 0 1 3 *", now)).toBe(true);
    expect(isDue("0 0 1 4 *", now)).toBe(false);
  });

  it("matches day of week (0=Sunday)", () => {
    // 2025-06-01 is a Sunday (day 0)
    const now = new Date("2025-06-01T00:00:00Z");
    expect(isDue("0 0 * * 0", now)).toBe(true);
    expect(isDue("0 0 * * 1", now)).toBe(false);
  });

  it("rejects invalid cron with wrong number of fields", () => {
    const now = new Date();
    expect(isDue("* * *", now)).toBe(false);
    expect(isDue("* * * * * *", now)).toBe(false);
    expect(isDue("", now)).toBe(false);
  });

  it("handles every-5-minutes cron", () => {
    const at5 = new Date("2025-01-01T00:05:00Z");
    const at7 = new Date("2025-01-01T00:07:00Z");
    expect(isDue("*/5 * * * *", at5)).toBe(true);
    expect(isDue("*/5 * * * *", at7)).toBe(false);
  });
});
