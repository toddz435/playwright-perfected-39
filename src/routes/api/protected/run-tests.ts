import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { executeTest } from "@/lib/test-runner.server";
import { acquireSlot, ConcurrencyError, RUN_LIMITS, mapPool } from "@/lib/concurrency.server";

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
          if (!tests || tests.length === 0)
            return json({ error: "No browser tests in this project" }, { status: 400 });

          // Run in parallel, capped at the per-user run limit (also respects the global cap via
          // acquireSlot). Each slot is released as soon as its run finishes.
          const results = await mapPool(tests, RUN_LIMITS.perUser, async (test) => {
            let release: () => void;
            try {
              release = acquireSlot("run", userId, RUN_LIMITS);
            } catch (e: any) {
              if (e instanceof ConcurrencyError)
                return { testId: test.id, name: test.name, skipped: "runner busy" };
              throw e;
            }
            try {
              const { status } = await executeTest(sb, test, userId, {});
              return { testId: test.id, name: test.name, status };
            } catch (e: any) {
              return { testId: test.id, name: test.name, error: e?.message || "Failed" };
            } finally {
              release();
            }
          });

          return json({
            tests: results.length,
            passed: results.filter((r) => r.status === "passed").length,
            failed: results.filter((r) => r.status === "failed").length,
            skipped: results.filter((r) => "skipped" in r || "error" in r).length,
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
