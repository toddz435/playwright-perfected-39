import { describe, it, expect, vi, beforeEach } from "vitest";
import { consumeLastCapturedError } from "./error-capture";

describe("consumeLastCapturedError", () => {
  beforeEach(() => {
    // Drain any leftover captured error from previous tests
    consumeLastCapturedError();
  });

  it("returns undefined when no error has been captured", () => {
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("captures and consumes an error event", () => {
    const testError = new Error("test failure");
    globalThis.dispatchEvent(new ErrorEvent("error", { error: testError }));

    const captured = consumeLastCapturedError();
    expect(captured).toBe(testError);
  });

  it("returns undefined on second call (consumed)", () => {
    globalThis.dispatchEvent(new ErrorEvent("error", { error: new Error("once") }));
    consumeLastCapturedError(); // first call consumes
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("captures unhandled rejection events", () => {
    const reason = new Error("rejected");
    globalThis.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        reason,
        promise: Promise.resolve(),
      }),
    );

    expect(consumeLastCapturedError()).toBe(reason);
  });

  it("returns undefined for expired errors (TTL exceeded)", () => {
    vi.useFakeTimers();
    globalThis.dispatchEvent(new ErrorEvent("error", { error: new Error("old") }));
    vi.advanceTimersByTime(6_000); // TTL is 5 seconds
    expect(consumeLastCapturedError()).toBeUndefined();
    vi.useRealTimers();
  });

  it("returns the error within TTL window", () => {
    vi.useFakeTimers();
    const err = new Error("recent");
    globalThis.dispatchEvent(new ErrorEvent("error", { error: err }));
    vi.advanceTimersByTime(3_000); // within 5s TTL
    expect(consumeLastCapturedError()).toBe(err);
    vi.useRealTimers();
  });
});
