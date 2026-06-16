import { describe, it, expect } from "vitest";
import { redactValues, redactHtml, redactSnippet } from "./redact";

describe("redactValues", () => {
  it("redacts quoted values on any tag (input, option, web components)", () => {
    expect(redactValues(`<input value="todd@x.com">`)).toContain('value="[redacted]"');
    expect(redactValues(`<x-field value='secret'>`)).toContain('value="[redacted]"');
    expect(redactValues(`<input value="a">`)).not.toContain('"a"');
  });

  it("redacts UNQUOTED values (the previous leak)", () => {
    const out = redactValues(`<input type=hidden value=ApiKey-abc123>`);
    expect(out).not.toContain("ApiKey-abc123");
    expect(out).toContain('value="[redacted]"');
  });

  it("does not touch data-value (no leading space before 'value')", () => {
    expect(redactValues(`<div data-value="keepme">`)).toContain('data-value="keepme"');
  });
});

describe("redactHtml", () => {
  it("drops script/style bodies and textarea contents", () => {
    const out = redactHtml(
      `<style>.a{color:red}</style><script>var t='abc123'</script><textarea>secret note</textarea>`,
    );
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("color:red");
    expect(out).not.toContain("secret note");
  });

  it("preserves structure, labels, placeholders, button text", () => {
    const html = `<label for="pw">Password</label><input id="pw" placeholder="Enter password" value="s3cret"><button>Sign in</button>`;
    const out = redactHtml(html);
    expect(out).toContain("Password");
    expect(out).toContain('placeholder="Enter password"');
    expect(out).toContain("<button>Sign in</button>");
    expect(out).not.toContain("s3cret");
  });
});

describe("redactSnippet", () => {
  it("redacts values, collapses whitespace, and truncates", () => {
    const out = redactSnippet(`<input\n   name="x"   value="secret">`, 240);
    expect(out).not.toContain("secret");
    expect(out).toContain('name="x"');
    expect(out).not.toMatch(/\s{2,}/);
  });
  it("truncates to the max length", () => {
    expect(redactSnippet("a".repeat(500), 50).length).toBe(50);
  });
});
