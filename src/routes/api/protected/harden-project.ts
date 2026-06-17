import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { hardenBrowserSteps } from "@/lib/harden.server";

// Hardens every browser test in a project in one pass: runs each against the live site,
// rewrites locators to validated resilient ones (+ fallbacks), and saves. Returns a
// per-test summary. Runs on the Node server only (Playwright).
export const Route = createFileRoute("/api/protected/harden-project")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { token } = await requireUser(request);
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

          const results: any[] = [];
          for (const test of tests) {
            const steps = (test.spec?.steps || []) as any[];
            if (steps.length === 0) {
              results.push({ testId: test.id, name: test.name, skipped: "no steps" });
              continue;
            }
            try {
              const { steps: hardened, report } = await hardenBrowserSteps(steps);
              await sb
                .from("tests")
                .update({ spec: { ...test.spec, steps: hardened } })
                .eq("id", test.id);
              results.push({
                testId: test.id,
                name: test.name,
                improved: report.filter((r) => r.status === "improved").length,
                kept: report.filter((r) => r.status === "kept").length,
                unresolved: report.filter((r) => r.status === "unresolved").length,
              });
            } catch (e: any) {
              results.push({ testId: test.id, name: test.name, error: e?.message || "Failed" });
            }
          }

          return json({
            tests: results.length,
            improved: results.reduce((n, r) => n + (r.improved || 0), 0),
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
