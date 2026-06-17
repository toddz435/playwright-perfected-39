import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isDue } from "@/lib/cron";
import { executeTest } from "@/lib/test-runner.server";

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
              // Same engine as interactive runs (real Playwright, heal, self-stabilize).
              const { status } = await executeTest(supabaseAdmin, test, sched.owner_id, {
                scheduled: true,
              });
              results.push({ schedule: sched.id, status });
            } catch (e: any) {
              results.push({ schedule: sched.id, error: e?.message });
            } finally {
              // Always advance last_run_at — even if the run errored — so a failing
              // schedule doesn't re-fire every poll (the dedupe window keys on this).
              await supabaseAdmin
                .from("schedules")
                .update({ last_run_at: now.toISOString() })
                .eq("id", sched.id);
            }
          }
          return new Response(
            JSON.stringify({ checked: schedules?.length || 0, ran: results.length, results }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        } catch (e: any) {
          console.error(e);
          return new Response(JSON.stringify({ error: e?.message || "Failed" }), { status: 500 });
        }
      },
    },
  },
});
