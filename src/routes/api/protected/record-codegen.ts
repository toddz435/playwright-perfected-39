import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { assertPublicUrl } from "@/lib/ssrf.server";
import { acquireSlot, ConcurrencyError, RECORDER_LIMITS } from "@/lib/concurrency.server";
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
// recorder (or the timeout fires). The child is launched in its own process group so the
// whole tree (codegen + browser) can be killed on timeout or client disconnect.
//
// SECURITY (tracked in docs/roadmap.md): gated to authenticated users; the recorded `url` is
// SSRF-checked (assertPublicUrl) — private/internal addresses are refused unless
// ALLOW_PRIVATE_HOSTS=true (set only on a trusted local machine, where recording localhost is
// intentional). Still owed before a cloud runner: a per-user concurrency cap and
// auto-converting recorded fill() values to {{secret}} so passwords aren't captured raw.
const RECORD_TIMEOUT_MS = 15 * 60 * 1000;
const ALLOW_PRIVATE_HOSTS = process.env.ALLOW_PRIVATE_HOSTS === "true";

export const Route = createFileRoute("/api/protected/record-codegen")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId } = await requireUser(request);
          const { url } = await request.json();
          if (!url || typeof url !== "string") {
            return json({ error: "A http(s) URL is required" }, { status: 400 });
          }
          // SSRF guard: scheme + resolve-and-block private/internal addresses (unless this is
          // a trusted local machine where recording localhost is intentional).
          try {
            await assertPublicUrl(url, ALLOW_PRIVATE_HOSTS);
          } catch (e: any) {
            return json({ error: e?.message || "URL not allowed" }, { status: 400 });
          }
          // Cap concurrent recordings (headed browser, up to 15 min) per user + globally.
          const release = acquireSlot("recording", userId, RECORDER_LIMITS);
          try {

          const outFile = join(
            tmpdir(),
            `testrify-codegen-${Date.now()}-${Math.floor(Math.random() * 1e6)}.spec.ts`,
          );
          const bin = join(process.cwd(), "node_modules/.bin/playwright");

          const script = await new Promise<string>((resolve, reject) => {
            // detached → its own process group, so we can kill codegen AND its browser.
            const child = spawn(
              bin,
              [
                "codegen",
                "--target",
                "playwright-test",
                "--test-id-attribute",
                "data-testid",
                "-o",
                outFile,
                "--", // end of options: the URL is a positional arg, never a flag
                url,
              ],
              { detached: true, stdio: "ignore" },
            );

            let settled = false;
            const cleanupFile = () => {
              unlink(outFile).catch(() => {});
            };
            const killTree = () => {
              try {
                if (child.pid) process.kill(-child.pid, "SIGTERM");
              } catch {
                try {
                  child.kill();
                } catch {
                  /* already gone */
                }
              }
            };
            const onAbort = () => end(() => reject(new Error("Recording cancelled.")), true);
            const timer = setTimeout(
              () => end(() => reject(new Error("Recording timed out.")), true),
              RECORD_TIMEOUT_MS,
            );

            // Single terminal path: clears the timer/listener, optionally kills the tree,
            // and (except on a clean read) removes the temp file.
            function end(action: () => void, killAndClean = false) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              request.signal?.removeEventListener?.("abort", onAbort);
              if (killAndClean) {
                killTree();
                cleanupFile();
              }
              action();
            }

            request.signal?.addEventListener?.("abort", onAbort);

            child.on("error", (e) =>
              end(() => {
                cleanupFile();
                reject(
                  new Error(
                    `Could not launch the recorder (${e.message}). Recording runs on the local server only.`,
                  ),
                );
              }),
            );
            child.on("close", async () => {
              if (settled) return;
              try {
                const s = await readFile(outFile, "utf8");
                cleanupFile();
                end(() => resolve(s));
              } catch {
                cleanupFile();
                end(() =>
                  reject(new Error("No script was captured — did the recording have any actions?")),
                );
              }
            });
          });

            return json({ script });
          } finally {
            release(); // free the recording slot on success, error, timeout, or disconnect
          }
        } catch (e: any) {
          if (e instanceof Response) return e;
          if (e instanceof ConcurrencyError) return json({ error: e.message }, { status: 429 });
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
