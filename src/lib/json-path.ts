// Resolve a dot-notation path against parsed JSON, for API `json_path_eq` assertions.
// Tolerant of a leading JSONPath-style "$" / "$." and stray leading dots (LLM-generated assertions
// often emit "$.id" instead of "id"), and of numeric segments for array indices ("items.0.id").
// Returns undefined when any segment is missing. Pure + unit-tested.
export function jsonPathValue(json: unknown, path: string): unknown {
  const segments = String(path)
    .replace(/^\$/, "") // drop a leading JSONPath root "$"
    .split(".")
    .filter(Boolean); // drop empty segments (e.g. the gap left by "$." → ".id")
  return segments.reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as any)[k]),
    json,
  );
}
