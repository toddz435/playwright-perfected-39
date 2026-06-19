// Server-only encryption for secret variable values (encryption-at-rest). Secret values are
// AES-256-GCM encrypted before they're written to the DB and decrypted on the server right
// before a run interpolates them. The key lives in SECRETS_KEY (base64 of 32 random bytes) —
// server env only, never shipped to the client. GCM is authenticated, so tampering/wrong-key
// is detected on decrypt instead of silently returning garbage.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { specVars } from "@/lib/vars";

const PREFIX = "enc:v1:"; // version tag so the format can evolve
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

function getKey(): Buffer {
  const raw = process.env.SECRETS_KEY;
  if (!raw) throw new Error("SECRETS_KEY is not configured");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes (base64-encoded)");
  return key;
}

// True if the encryption key is available (for graceful "can we encrypt?" checks).
export function hasSecretsKey(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

// True if a value is one of our encrypted blobs (vs. plaintext / legacy).
export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

// Encrypts a plaintext secret → `enc:v1:{iv}:{ciphertext}:{tag}` (each base64).
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, ct, tag].map((b) => b.toString("base64")).join(":");
}

// The DECRYPTED plaintext values of a spec's secret variables — for masking them out of run
// records and anything sent to the LLM. Best-effort: a value that can't be decrypted (missing
// key / tamper) is skipped rather than throwing, since this only feeds redaction.
export function decryptedSecretValues(spec: any): string[] {
  const vars = specVars(spec);
  const names: string[] = Array.isArray(spec?.secrets) ? spec.secrets : [];
  return names
    .map((n) => {
      try {
        return decryptSecret(String(vars[n] ?? ""));
      } catch {
        return "";
      }
    })
    .filter((v) => v.length > 0);
}

// Decrypts an encrypted blob. A value that isn't one of our blobs (plaintext / legacy secret)
// is returned unchanged — so existing plaintext secrets keep working until re-saved. Throws on
// a malformed blob or failed authentication (tamper / wrong key) rather than returning garbage.
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value;
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("malformed encrypted secret");
  const [iv, ct, tag] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
