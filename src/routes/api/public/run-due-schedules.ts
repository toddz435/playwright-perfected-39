import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isDue } from "@/lib/cron";
import { executeTest } from "@/lib/test-runner.server";
import { acquireSlot, RUN_LIMITS } from "@/lib/concurrency.server";

// Constant-time secret comparison (avoids leaking the secret via response timing).
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const Route = createFileRoute("/api/public/run-due-schedules")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // This endpoint runs scheduled tests with ADMIN (service-role) privileges, so it must only
        // be callable by the cron. Require a shared CRON_SECRET (header `x-cron-secret` or a Bearer
        // token). FAIL CLOSED: if CRON_SECRET isn't configured, refuse — never an open admin trigger.
        const expected = process.env.CRON_SECRET;
        if (!expected) return json({ error: "Scheduling not configured (CRON_SECRET unset)." }, 503);
        const provided =
          request.headers.get("x-cron-secret") ||
          (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
        if (!secretMatches(provided, expected)) return json({ error: "Unauthorized" }, 401);

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
            // Respect the same global/per-user run cap as interactive runs so scheduled load
            // can't exhaust the runner. If at capacity, skip this cycle WITHOUT advancing
            // last_run_at, so the schedule retries on the next poll rather than piling on.
            let release: () => void;
            try {
              release = acquireSlot("run", sched.owner_id, RUN_LIMITS);
            } catch {
              results.push({ schedule: sched.id, skipped: "runner at capacity" });
              continue;
            }
            try {
              // Same engine as interactive runs (real Playwright, heal, self-stabilize).
              const { status } = await executeTest(supabaseAdmin, test, sched.owner_id, {
                scheduled: true,
              });
              results.push({ schedule: sched.id, status });
            } catch (e: any) {
              results.push({ schedule: sched.id, error: e?.message });
            } finally {
              release();
              // Advance last_run_at when we actually ran (success or error) — even if the run
              // errored — so a failing schedule doesn't re-fire every poll (dedupe keys on this).
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
