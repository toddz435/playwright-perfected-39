import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { executeTest } from "@/lib/test-runner.server";
import { acquireSlot, ConcurrencyError, RUN_LIMITS, mapPool } from "@/lib/concurrency.server";
import { quotaBlock } from "@/lib/quota.server";
import { runnerConfigured } from "@/lib/runner-client.server";

// Runs every browser test in a project IN PARALLEL, bounded to the per-user run cap so it
// can't exceed the runner's concurrency limits. Each test still acquires a run slot; if the
// runner is busy with other runs, that test is skipped (not piled on). Returns a summary.
export const Route = createFileRoute("/api/protected/run-tests")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token } = await requireUser(request);
          const { projectId } = await request.json();
          if (!projectId) return json({ error: "projectId required" }, { status: 400 });

          // Cloud: "Run all" isn't wired to the Railway runner yet — fail clean rather than hit
          // the Worker's Playwright stub. (Single Run already works in the cloud.)
          if (runnerConfigured()) {
            return json(
              { error: "Run-all isn't available in the cloud yet — use single Run, or run locally." },
              { status: 501 },
            );
          }

          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: tests, error: tErr } = await sb
            .from("tests")
            .select("*")
            .eq("project_id", projectId)
            .eq("type", "browser");
          if (tErr) return json({ error: tErr.message }, { status: 500 });

          // Monthly run quota (freemium). No-op while QUOTA_ENFORCED is off.
          const quota = await quotaBlock(sb);
          if (quota) return json({ error: quota }, { status: 429 });

          if (!tests || tests.length === 0)
            return json({ error: "No browser tests in this project" }, { status: 400 });

          // Run in parallel, capped at the per-user run limit (also respects the global cap via
          // acquireSlot). Each slot is released as soon as its run finishes. mapPool's fn must
          // not throw (it catches its own errors below), else Promise.all would abandon the rest.
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
          const results = await mapPool(tests, RUN_LIMITS.perUser, async (test) => {
            // Wait briefly for a free slot (e.g. an interactive run finishing) instead of
            // immediately skipping, so the batch actually runs every test under contention.
            const slotDeadline = Date.now() + 30_000;
            let release: () => void | undefined;
            while (true) {
              try {
                release = acquireSlot("run", userId, RUN_LIMITS);
                break;
              } catch (e: any) {
                if (e instanceof ConcurrencyError && Date.now() < slotDeadline) {
                  await sleep(400);
                  continue;
                }
                if (e instanceof ConcurrencyError)
                  return { testId: test.id, name: test.name, skipped: "runner busy" } as const;
                throw e;
              }
            }
            try {
              const { status } = await executeTest(sb, test, userId, {});
              return { testId: test.id, name: test.name, status } as const;
            } catch (e: any) {
              return { testId: test.id, name: test.name, error: e?.message || "Failed" } as const;
            } finally {
              release!();
            }
          });

          return json({
            tests: results.length,
            passed: results.filter((r) => "status" in r && r.status === "passed").length,
            failed: results.filter((r) => "status" in r && r.status === "failed").length,
            errored: results.filter((r) => "error" in r).length,
            skipped: results.filter((r) => "skipped" in r).length,
            results,
          });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
