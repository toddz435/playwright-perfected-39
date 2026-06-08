import { createFileRoute } from "@tanstack/react-router";
import { requireAgentKey } from "@/lib/agent-auth.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json } from "@/lib/server-auth.server";

export const Route = createFileRoute("/api/agent/report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          requireAgentKey(request);

          const body = await request.json();
          const { runId, status, stepResults, startedAt, finishedAt, durationMs } = body;

          if (!runId || !status) {
            return json({ error: "runId and status are required" }, { status: 400 });
          }

          const passed = (stepResults || []).filter(
            (s: { status: string }) => s.status === "passed",
          ).length;
          const failed = (stepResults || []).filter(
            (s: { status: string }) => s.status === "failed",
          ).length;

          const { error } = await supabaseAdmin
            .from("runs")
            .update({
              status,
              started_at: startedAt,
              finished_at: finishedAt,
              duration_ms: durationMs,
              steps: stepResults || [],
              summary: {
                total: (stepResults || []).length,
                passed,
                failed,
                agent: true,
              },
            })
            .eq("id", runId);

          if (error) return json({ error: error.message }, { status: 500 });

          return json({ ok: true });
        } catch (e) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: (e as Error)?.message || "Internal error" }, { status: 500 });
        }
      },
    },
  },
});
