import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Spawns Playwright's recorder (`playwright codegen <url>`) on the Node runner. A real
// Chromium window opens locally; the user interacts, then closes it. We read the generated
// script and hand it back for parsing/hardening via the existing codegen pipeline.
//
// LOCAL / Node-runner only — opens a headed browser on the machine running the server, and
// cannot run in the Cloudflare Worker. The request stays open until the user closes the
// recorder (or the timeout fires).
const RECORD_TIMEOUT_MS = 15 * 60 * 1000;

export const Route = createFileRoute("/api/protected/record-codegen")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const { url } = await request.json();
          if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
            return json({ error: "A http(s) URL is required" }, { status: 400 });
          }

          const outFile = join(
            tmpdir(),
            `testrify-codegen-${Date.now()}-${Math.floor(Math.random() * 1e6)}.spec.ts`,
          );
          const bin = join(process.cwd(), "node_modules/.bin/playwright");

          const script = await new Promise<string>((resolve, reject) => {
            const child = spawn(
              bin,
              [
                "codegen",
                url,
                "-o",
                outFile,
                "--target",
                "playwright-test",
                // Prefer data-testid selectors when present — matches our locator model.
                "--test-id-attribute",
                "data-testid",
              ],
              { stdio: "ignore" },
            );
            const timer = setTimeout(() => {
              child.kill();
              reject(new Error("Recording timed out."));
            }, RECORD_TIMEOUT_MS);
            child.on("error", (e) => {
              clearTimeout(timer);
              reject(
                new Error(
                  `Could not launch the recorder (${e.message}). Recording runs on the local server only.`,
                ),
              );
            });
            child.on("close", async () => {
              clearTimeout(timer);
              try {
                const s = await readFile(outFile, "utf8");
                await unlink(outFile).catch(() => {});
                resolve(s);
              } catch {
                reject(new Error("No script was captured — did the recording have any actions?"));
              }
            });
          });

          return json({ script });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
