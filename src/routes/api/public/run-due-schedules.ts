import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isDue } from "@/lib/cron";
import { executeTest } from "@/lib/test-runner.server";

async function runTest(test: any, ownerId: string) {
  const result = await executeTest(test, { failRate: 0.15 });

  await supabaseAdmin.from("runs").insert({
    test_id: test.id, owner_id: ownerId, status: result.status,
    started_at: result.startedAt, finished_at: result.finishedAt,
    duration_ms: result.durationMs, steps: result.stepResults as any,
    summary: { ...result.summary, scheduled: true } as any,
  });
  return result.status;
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
              if (now.getTime() - last < 55_000) return false;
            }
            return true;
          });

          const results: any[] = [];
          for (const sched of due) {
            const { data: test } = await supabaseAdmin.from("tests").select("*").eq("id", sched.test_id).single();
            if (!test) continue;
            try {
              const status = await runTest(test, sched.owner_id);
              await supabaseAdmin.from("schedules").update({ last_run_at: now.toISOString() }).eq("id", sched.id);
              results.push({ schedule: sched.id, status });
            } catch (e: any) {
              results.push({ schedule: sched.id, error: e?.message });
            }
          }
          return new Response(JSON.stringify({ checked: schedules?.length || 0, ran: results.length, results }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        } catch (e: any) {
          console.error(e);
          return new Response(JSON.stringify({ error: e?.message || "Failed" }), { status: 500 });
        }
      },
    },
  },
});
