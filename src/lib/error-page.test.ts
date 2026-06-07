import { describe, it, expect } from "vitest";
import { renderErrorPage } from "./error-page";

describe("renderErrorPage", () => {
  it("returns an HTML string", () => {
    const html = renderErrorPage();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("</html>");
  });

  it("includes error title", () => {
    const html = renderErrorPage();
    expect(html).toContain("This page didn't load");
  });

  it("includes a retry button", () => {
    const html = renderErrorPage();
    expect(html).toContain("Try again");
    expect(html).toContain("location.reload()");
  });

  it("includes a go-home link", () => {
    const html = renderErrorPage();
    expect(html).toContain('href="/"');
    expect(html).toContain("Go home");
  });

  it("includes meta viewport for responsiveness", () => {
    const html = renderErrorPage();
    expect(html).toContain("viewport");
    expect(html).toContain("width=device-width");
  });
});
