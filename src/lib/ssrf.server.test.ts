import { describe, it, expect } from "vitest";
import { isPrivateIp, assertPublicUrl } from "./ssrf.server";

describe("isPrivateIp", () => {
  it("flags private / internal IPv4", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "169.254.169.254", // cloud metadata
      "0.0.0.0",
      "100.64.0.1", // CGNAT
    ])
      expect(isPrivateIp(ip)).toBe(true);
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.169.0.1"])
      expect(isPrivateIp(ip)).toBe(false);
  });

  it("handles IPv6 + IPv4-mapped (dotted AND hex)", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("febf::1")).toBe(true); // fe80::/10 upper bound
    expect(isPrivateIp("fd00::1")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true); // dotted mapped
    // Hex IPv4-mapped — the form `new URL` canonicalizes to (was the bypass).
    expect(isPrivateIp("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("::ffff:0a00:0001")).toBe(true); // 10.0.0.1
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false); // public (Cloudflare DNS)
  });

  it("treats malformed input as unsafe", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
    expect(isPrivateIp("999.999.999.999")).toBe(true);
  });
});

describe("assertPublicUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(assertPublicUrl("file:///etc/passwd", false)).rejects.toThrow(/http/);
    await expect(assertPublicUrl("ftp://example.com", false)).rejects.toThrow(/http/);
  });

  it("rejects an invalid URL", async () => {
    await expect(assertPublicUrl("not a url", false)).rejects.toThrow(/Invalid/);
  });

  it("blocks loopback/metadata literals when private is not allowed", async () => {
    await expect(assertPublicUrl("http://127.0.0.1:3000", false)).rejects.toThrow(/private/i);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data", false)).rejects.toThrow(
      /private/i,
    );
  });

  it("allows private when explicitly permitted (local recording)", async () => {
    await expect(assertPublicUrl("http://localhost:8080", true)).resolves.toBeUndefined();
    await expect(assertPublicUrl("http://127.0.0.1:3000", true)).resolves.toBeUndefined();
  });
});
