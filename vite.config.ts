// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // Playwright (used by the in-process browser test runner during local dev) ships native
  // .node binaries and lazy requires that must not be bundled — keep them external so they
  // load as real Node modules at runtime. NOTE: real browser execution only runs on the
  // Node dev/preview server, not in the Cloudflare Worker build.
  vite: {
    ssr: {
      // pngjs/pixelmatch back the visual-regression diff (Node-only, dynamic-imported).
      external: ["@playwright/test", "playwright", "playwright-core", "pngjs", "pixelmatch"],
    },
    optimizeDeps: {
      exclude: ["@playwright/test", "playwright", "playwright-core", "pngjs", "pixelmatch"],
    },
  },
});
