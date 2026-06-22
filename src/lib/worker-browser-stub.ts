// Cloudflare Worker build stub.
//
// Playwright (@playwright/test / playwright / playwright-core) and the image-diff libraries
// (pngjs, pixelmatch) are Node-only and run EXCLUSIVELY on the Testrify runner — never inside
// the Cloudflare Worker (V8 isolates have no Node runtime and no browser binaries). The app only
// ever reaches them via dynamic `await import(...)` inside test-execution / recording / visual-diff
// code paths, which are delegated to the runner (the local Node dev server today, Railway next).
//
// wrangler.jsonc aliases those module specifiers to THIS file for the Worker bundle so the build
// doesn't try to pull in chromium-bidi & friends. If any of these are actually invoked on the web
// tier, we throw a clear error rather than 500 cryptically — that call belongs on the runner.

const fail = (): never => {
  throw new Error(
    "Browser/test execution is not available on the web tier — it runs on the Testrify runner.",
  );
};

// A callable + constructable + property-accessible trap: every interaction throws `fail()`.
// Covers `chromium.launch()`, `new PNG()`, `pixelmatch(...)`, etc.
const trap: any = new Proxy(function () {} as unknown as object, {
  get: fail,
  apply: fail,
  construct: fail,
});

export const chromium = trap;
export const firefox = trap;
export const webkit = trap;
export const PNG = trap;
export default trap;
