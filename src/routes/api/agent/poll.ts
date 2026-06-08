import { createFileRoute } from "@tanstack/react-router";
import { requireAgentKey } from "@/lib/agent-auth.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json } from "@/lib/server-auth.server";

export const Route = createFileRoute("/api/agent/poll")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          requireAgentKey(request);

          // Find the oldest queued run (status = 'queued')
          const { data: run, error } = await supabaseAdmin
            .from("runs")
            .select("id, test_id, status, steps, summary")
            .eq("status", "queued")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (error) return json({ error: error.message }, { status: 500 });

          if (!run) {
            // No work available
            return new Response(null, { status: 204 });
          }

          // Fetch the test spec
          const { data: test, error: tErr } = await supabaseAdmin
            .from("tests")
            .select("id, type, spec")
            .eq("id", run.test_id)
            .single();

          if (tErr || !test) return json({ error: "Test not found" }, { status: 404 });

          // Mark as running so no other agent picks it up
          await supabaseAdmin.from("runs").update({ status: "running" }).eq("id", run.id);

          const resumeFromStep =
            typeof run.summary === "object" &&
            run.summary !== null &&
            "resumeFromStep" in run.summary
              ? (run.summary as Record<string, unknown>).resumeFromStep
              : undefined;

          return json({
            run: {
              id: run.id,
              testId: test.id,
              resumeFromStep,
              spec: {
                type: test.type,
                steps: test.spec?.steps || [],
              },
            },
          });
        } catch (e) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: (e as Error)?.message || "Internal error" }, { status: 500 });
        }
      },
    },
  },
});
