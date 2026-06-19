import { describe, it, expect } from "vitest";
import { parseDelimited, normalizeColumn } from "./dataset";

describe("normalizeColumn", () => {
  it("makes names variable-safe ({{col}})", () => {
    expect(normalizeColumn("Email", 0)).toBe("Email");
    expect(normalizeColumn("First Name", 0)).toBe("First_Name");
    expect(normalizeColumn("  spaced  ", 0)).toBe("spaced");
    expect(normalizeColumn("a/b@c", 0)).toBe("a_b_c");
    expect(normalizeColumn("", 2)).toBe("col3");
  });
});

describe("parseDelimited", () => {
  it("parses CSV with a header row into columns + row objects", () => {
    const d = parseDelimited("email,password\na@x.com,secret\nb@y.com,hunter2");
    expect(d.columns).toEqual(["email", "password"]);
    expect(d.rows).toEqual([
      { email: "a@x.com", password: "secret" },
      { email: "b@y.com", password: "hunter2" },
    ]);
  });

  it("auto-detects tab-delimited paste (Excel/Sheets)", () => {
    const d = parseDelimited("name\tage\nTodd\t40");
    expect(d.columns).toEqual(["name", "age"]);
    expect(d.rows).toEqual([{ name: "Todd", age: "40" }]);
  });

  it("honors quoted fields with embedded commas and escaped quotes", () => {
    const d = parseDelimited('a,b\n"x,y","she said ""hi"""');
    expect(d.rows).toEqual([{ a: "x,y", b: 'she said "hi"' }]);
  });

  it("normalizes + de-dupes header names", () => {
    const d = parseDelimited("First Name,First Name\nA,B");
    expect(d.columns).toEqual(["First_Name", "First_Name_2"]);
    expect(d.rows[0]).toEqual({ First_Name: "A", First_Name_2: "B" });
  });

  it("keeps de-duped names unique even when a suffix collides with a literal", () => {
    const d = parseDelimited("a,a,a_2\n1,2,3");
    expect(new Set(d.columns).size).toBe(3); // all unique
    expect(d.columns).toEqual(["a", "a_2", "a_2_2"]);
  });

  it("drops fully-blank rows and trims cells", () => {
    const d = parseDelimited("x\n 1 \n\n2");
    expect(d.rows).toEqual([{ x: "1" }, { x: "2" }]);
  });

  it("handles empty / whitespace input", () => {
    expect(parseDelimited("")).toEqual({ columns: [], rows: [] });
    expect(parseDelimited("   \n  ")).toEqual({ columns: [], rows: [] });
  });

  it("handles CRLF line endings", () => {
    const d = parseDelimited("a,b\r\n1,2\r\n3,4");
    expect(d.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });
});
