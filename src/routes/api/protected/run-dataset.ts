import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { executeTest } from "@/lib/test-runner.server";
import { acquireSlot, ConcurrencyError, RUN_LIMITS, mapPool } from "@/lib/concurrency.server";

// Data-Driven Testing: runs a test once per row of its attached dataset (spec.datasetId),
// binding each row's columns to the test's {{variables}}. Runs in parallel bounded by the
// per-user run cap (waits for a free slot rather than dropping). Returns a per-row summary.
export const Route = createFileRoute("/api/protected/run-dataset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token } = await requireUser(request);
          const { testId } = await request.json();
          if (!testId) return json({ error: "testId required" }, { status: 400 });

          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: test, error: tErr } = await sb
            .from("tests")
            .select("*")
            .eq("id", testId)
            .single();
          if (tErr || !test) return json({ error: "Test not found" }, { status: 404 });
          const datasetId = test.spec?.datasetId;
          if (!datasetId) return json({ error: "No dataset attached to this test" }, { status: 400 });

          const { data: dataset, error: dErr } = await sb
            .from("datasets")
            .select("*")
            .eq("id", datasetId)
            .single();
          if (dErr || !dataset) return json({ error: "Dataset not found" }, { status: 404 });
          const columns: string[] = dataset.columns || [];
          const rows: Record<string, any>[] = Array.isArray(dataset.rows) ? dataset.rows : [];
          if (!rows.length) return json({ error: "The dataset has no rows" }, { status: 400 });

          const labelOf = (row: Record<string, any>, i: number) =>
            columns
              .map((c) => String(row[c] ?? ""))
              .filter(Boolean)
              .join(" · ")
              .slice(0, 60) || `Row ${i + 1}`;
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

          const results = await mapPool(rows, RUN_LIMITS.perUser, async (row, i) => {
            const label = labelOf(row, i);
            const overrides = Object.fromEntries(
              columns.map((c) => [c, String(row[c] ?? "")]),
            );
            // Wait briefly for a free run slot instead of immediately skipping.
            const slotDeadline = Date.now() + 30_000;
            let release: () => void;
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
                  return { row: i, label, skipped: "runner busy" } as const;
                // Never reject — mapPool would abandon the other rows.
                return { row: i, label, error: e?.message || "Failed to acquire a slot" } as const;
              }
            }
            try {
              // noStabilize: parallel rows run the same test, so don't race the spec write.
              const { run } = await executeTest(sb, test, userId, {
                varsOverride: overrides,
                noStabilize: true,
              });
              return { row: i, label, status: run.status, runId: run.id } as const;
            } catch (e: any) {
              return { row: i, label, error: e?.message || "Failed" } as const;
            } finally {
              release!();
            }
          });

          return json({
            rows: results.length,
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
