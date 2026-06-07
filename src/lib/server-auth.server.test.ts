import { describe, it, expect } from "vitest";
import { json } from "./server-auth.server";

describe("json helper", () => {
  it("returns a Response with JSON content-type", async () => {
    const res = json({ ok: true });
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("serializes the data as JSON body", async () => {
    const res = json({ foo: "bar", count: 42 });
    const body = await res.json();
    expect(body).toEqual({ foo: "bar", count: 42 });
  });

  it("applies custom status code", async () => {
    const res = json({ error: "not found" }, { status: 404 });
    expect(res.status).toBe(404);
  });

  it("merges custom headers with content-type", async () => {
    const res = json({ ok: true }, { headers: { "x-request-id": "abc123" } });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-request-id")).toBe("abc123");
  });

  it("handles empty object", async () => {
    const res = json({});
    const body = await res.json();
    expect(body).toEqual({});
  });

  it("handles arrays", async () => {
    const res = json([1, 2, 3]);
    const body = await res.json();
    expect(body).toEqual([1, 2, 3]);
  });

  it("handles null", async () => {
    const res = json(null);
    const body = await res.json();
    expect(body).toBeNull();
  });
});
