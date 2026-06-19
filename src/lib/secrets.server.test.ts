import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted, hasSecretsKey } from "./secrets.server";

beforeAll(() => {
  // Deterministic 32-byte key for the test run.
  process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("secrets.server", () => {
  it("round-trips a secret", () => {
    const secret = "hunter2-π-😀";
    const enc = encryptSecret(secret);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("uses a fresh IV each time (same plaintext → different ciphertext)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("passes plaintext / legacy values through unchanged", () => {
    expect(isEncrypted("plain")).toBe(false);
    expect(decryptSecret("plain")).toBe("plain");
    expect(decryptSecret("")).toBe("");
  });

  it("rejects a tampered blob (GCM auth)", () => {
    const enc = encryptSecret("topsecret");
    // Flip a character in the ciphertext segment.
    const parts = enc.slice("enc:v1:".length).split(":");
    parts[1] = parts[1][0] === "A" ? "B" + parts[1].slice(1) : "A" + parts[1].slice(1);
    const tampered = "enc:v1:" + parts.join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws on a malformed encrypted blob", () => {
    expect(() => decryptSecret("enc:v1:onlyonepart")).toThrow(/malformed/);
  });

  it("reports key availability", () => {
    expect(hasSecretsKey()).toBe(true);
  });
});
