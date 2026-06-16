import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isDue } from "@/lib/cron";
import { runBrowserSteps } from "@/lib/playwright-runner.server";
import { healSelector } from "@/lib/heal.server";
import { applyRecoveries } from "@/lib/recovery";

async function runTest(test: any, ownerId: string) {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const stepResults: any[] = [];
  let status: "passed" | "failed" = "passed";
  let stabilizedSteps: any[] | null = null;

  if (test.type === "api") {
    const requests = (test.spec?.requests || []) as any[];
    for (let i = 0; i < requests.length; i++) {
      const req = requests[i];
      const sStart = Date.now();
      try {
        const res = await fetch(req.url, {
          method: req.method,
          headers: req.headers || {},
          body: req.body && req.method !== "GET" ? req.body : undefined,
        });
        const elapsed = Date.now() - sStart;
        const text = await res.text();
        let stepOk = true;
        const checks: any[] = [];
        for (const a of req.assertions || []) {
          let ok = false;
          let actual = "";
          try {
            if (a.kind === "status_eq") {
              ok = res.status === Number(a.expected);
              actual = String(res.status);
            } else if (a.kind === "status_lt") {
              ok = res.status < Number(a.expected);
              actual = String(res.status);
            } else if (a.kind === "time_lt_ms") {
              ok = elapsed < Number(a.expected);
              actual = `${elapsed}ms`;
            } else if (a.kind === "body_contains") {
              ok = text.includes(String(a.expected));
              actual = ok ? "found" : "missing";
            }
          } catch {
            ok = false;
          }
          if (!ok) stepOk = false;
          checks.push({ ...a, ok, actual });
        }
        stepResults.push({
          idx: i,
          name: req.name,
          status: stepOk ? "passed" : "failed",
          duration_ms: elapsed,
          http_status: res.status,
          checks,
        });
        if (!stepOk) {
          status = "failed";
          break;
        }
      } catch (e: any) {
        stepResults.push({
          idx: i,
          name: req.name,
          status: "failed",
          error: e?.message || "Network error",
        });
        status = "failed";
        break;
      }
    }
  } else {
    // Browser: real Playwright execution (same engine as interactive runs). Runs on the
    // Node server only, not the Cloudflare Worker. AI healing is on unless the test opts
    // out via spec.aiHealing = false.
    const steps = (test.spec?.steps || []) as any[];
    const aiHealing = test.spec?.aiHealing !== false;
    const result = await runBrowserSteps(steps, {
      heal: aiHealing ? healSelector : undefined,
    });
    stepResults.push(...result.steps);
    if (result.status === "failed") status = "failed";
    const { steps: stabilized, changed } = applyRecoveries(steps, result.steps);
    if (changed > 0) stabilizedSteps = stabilized;
  }

  await supabaseAdmin.from("runs").insert({
    test_id: test.id,
    owner_id: ownerId,
    status,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    steps: stepResults,
    summary: {
      type: test.type,
      total: stepResults.length,
      passed: stepResults.filter((s) => s.status === "passed").length,
      healed: stepResults.filter((s) => s.status === "healed").length,
      failed: stepResults.filter((s) => s.status === "failed").length,
      scheduled: true,
    },
  });

  // Persist self-stabilized locators after the run is recorded (non-fatal).
  if (stabilizedSteps) {
    try {
      await supabaseAdmin
        .from("tests")
        .update({ spec: { ...test.spec, steps: stabilizedSteps } })
        .eq("id", test.id);
    } catch (e: any) {
      console.error("scheduled self-stabilize persist failed:", e?.message || e);
    }
  }
  return status;
}

export const Route = createFileRoute("/api/public/run-due-schedules")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const now = new Date();
          const { data: schedules, error } = await supabaseAdmin
            .from("schedules")
            .select("*")
            .eq("enabled", true);
          if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

          const due = (schedules || []).filter((s) => {
            if (!isDue(s.cron, now)) return false;
            if (s.last_run_at) {
              const last = new Date(s.last_run_at).getTime();
              if (now.getTime() - last < 55_000) return false; // dedupe within same minute
            }
            return true;
          });

          const results: any[] = [];
          for (const sched of due) {
            const { data: test } = await supabaseAdmin
              .from("tests")
              .select("*")
              .eq("id", sched.test_id)
              .single();
            if (!test) continue;
            try {
              const status = await runTest(test, sched.owner_id);
              await supabaseAdmin
                .from("schedules")
                .update({ last_run_at: now.toISOString() })
                .eq("id", sched.id);
              results.push({ schedule: sched.id, status });
            } catch (e: any) {
              results.push({ schedule: sched.id, error: e?.message });
            }
          }
          return new Response(
            JSON.stringify({ checked: schedules?.length || 0, ran: results.length, results }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        } catch (e: any) {
          console.error(e);
          return new Response(JSON.stringify({ error: e?.message || "Failed" }), { status: 500 });
        }
      },
    },
  },
});
