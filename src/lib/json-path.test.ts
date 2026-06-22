import { describe, it, expect } from "vitest";
import { jsonPathValue } from "./json-path";

describe("jsonPathValue", () => {
  const body = { id: 1, userId: 7, title: "hi", nested: { a: { b: "deep" } }, items: [{ name: "Ada" }] };

  it("resolves a plain dot path", () => {
    expect(jsonPathValue(body, "id")).toBe(1);
    expect(jsonPathValue(body, "nested.a.b")).toBe("deep");
  });
  it("tolerates a leading JSONPath $ / $. (the LLM bug that returned undefined)", () => {
    expect(jsonPathValue(body, "$.id")).toBe(1);
    expect(jsonPathValue(body, "$id")).toBe(1);
    expect(jsonPathValue(body, ".id")).toBe(1);
  });
  it("indexes into arrays via numeric segments", () => {
    expect(jsonPathValue(body, "items.0.name")).toBe("Ada");
    expect(jsonPathValue(body, "$.items.0.name")).toBe("Ada");
  });
  it("returns undefined for a missing path without throwing", () => {
    expect(jsonPathValue(body, "nope")).toBeUndefined();
    expect(jsonPathValue(body, "nested.x.y")).toBeUndefined();
    expect(jsonPathValue(null, "id")).toBeUndefined();
  });
});
