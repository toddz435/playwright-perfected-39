import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/cli.mjs",
  banner: { js: "#!/usr/bin/env node" },
  external: ["playwright", "playwright/test"],
});

console.log("Built dist/cli.mjs");
