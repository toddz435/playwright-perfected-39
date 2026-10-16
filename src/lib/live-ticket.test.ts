import { describe, it, expect } from "vitest";
import {
  signLiveTicket,
  verifyLiveTicket,
  isValidLiveId,
  LIVE_TICKET_TTL_MS,
} from "./live-ticket.server";

const SECRET = "test-secret";
const LIVE_ID = "3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b";
const NOW = 1_700_000_000_000;

describe("live tickets", () => {
  it("round-trips a valid ticket", () => {
    const t = signLiveTicket(SECRET, "user-1", LIVE_ID, NOW);
    expect(verifyLiveTicket(SECRET, t, NOW + 1000)).toEqual({
      userId: "user-1",
      liveId: LIVE_ID,
      exp: NOW + LIVE_TICKET_TTL_MS,
    });
  });

  it("rejects an expired ticket", () => {
    const t = signLiveTicket(SECRET, "user-1", LIVE_ID, NOW);
    expect(verifyLiveTicket(SECRET, t, NOW + LIVE_TICKET_TTL_MS + 1)).toBeNull();
  });

  it("rejects a ticket signed with a different secret", () => {
    const t = signLiveTicket("other-secret", "user-1", LIVE_ID, NOW);
    expect(verifyLiveTicket(SECRET, t, NOW)).toBeNull();
  });

  it("rejects a tampered payload (swapping in another user)", () => {
    const t = signLiveTicket(SECRET, "user-1", LIVE_ID, NOW);
    const [, mac] = t.split(".");
    const forged = Buffer.from(
      JSON.stringify({ userId: "user-2", liveId: LIVE_ID, exp: NOW + LIVE_TICKET_TTL_MS }),
    ).toString("base64url");
    expect(verifyLiveTicket(SECRET, `${forged}.${mac}`, NOW)).toBeNull();
  });

  it("rejects garbage and an empty secret", () => {
    expect(verifyLiveTicket(SECRET, "not-a-ticket", NOW)).toBeNull();
    expect(verifyLiveTicket(SECRET, "a.b.c", NOW)).toBeNull();
    const t = signLiveTicket(SECRET, "user-1", LIVE_ID, NOW);
    expect(verifyLiveTicket("", t, NOW)).toBeNull();
  });

  it("only accepts UUID live ids", () => {
    expect(isValidLiveId(LIVE_ID)).toBe(true);
    expect(isValidLiveId("../etc")).toBe(false);
    expect(() => signLiveTicket(SECRET, "user-1", "nope", NOW)).toThrow();
  });
});
