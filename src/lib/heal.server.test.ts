import { describe, it, expect } from "vitest";
import { redactHtml } from "./heal.server";

describe("redactHtml", () => {
  it("drops script and style bodies", () => {
    const out = redactHtml(
      `<style>.a{color:red}</style><div>hi</div><script>var token='abc123'</script>`,
    );
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("color:red");
    expect(out).toContain("<div>hi</div>");
  });

  it("redacts user-entered input values", () => {
    const out = redactHtml(`<input id="email" type="email" value="todd@secret.com">`);
    expect(out).not.toContain("todd@secret.com");
    expect(out).toContain('value="[redacted]"');
    // structure/attributes the healer needs are preserved
    expect(out).toContain('id="email"');
    expect(out).toContain('type="email"');
  });

  it("redacts single-quoted values and textarea contents", () => {
    expect(redactHtml(`<input value='hunter2'>`)).toContain('value="[redacted]"');
    const ta = redactHtml(`<textarea name="notes">my private note</textarea>`);
    expect(ta).not.toContain("my private note");
    expect(ta).toContain('<textarea name="notes">[redacted]</textarea>');
  });

  it("preserves structure, labels, placeholders, and button text for healing", () => {
    const html = `<label for="pw">Password</label><input id="pw" placeholder="Enter password" value="s3cret"><button>Sign in</button>`;
    const out = redactHtml(html);
    expect(out).toContain("Password");
    expect(out).toContain('placeholder="Enter password"');
    expect(out).toContain("<button>Sign in</button>");
    expect(out).not.toContain("s3cret");
  });
});
