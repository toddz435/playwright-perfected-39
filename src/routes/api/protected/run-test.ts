import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/server-auth.server";
import { protectedHandler } from "@/lib/api-handler.server";
import { createUserClient } from "@/lib/supabase-user-client.server";
import { executeTest } from "@/lib/test-runner.server";

export const Route = createFileRoute("/api/protected/run-test")({
  server: {
    handlers: {
      POST: protectedHandler(async ({ userId, token, body }) => {
        const { testId, resumeFromStep } = body;
        if (!testId) return json({ error: "testId required" }, { status: 400 });

        const sb = createUserClient(token);
        const { data: test, error: tErr } = await sb.from("tests").select("*").eq("id", testId).single();
        if (tErr || !test) return json({ error: "Test not found" }, { status: 404 });

        const result = await executeTest(test, { startIdx: Number(resumeFromStep) || 0 });

        const { data: run, error: rErr } = await sb.from("runs").insert({
          test_id: testId, owner_id: userId, status: result.status,
          started_at: result.startedAt, finished_at: result.finishedAt,
          duration_ms: result.durationMs, steps: result.stepResults, summary: result.summary,
        }).select().single();
        if (rErr) return json({ error: rErr.message }, { status: 500 });
        return json({ run });
      }),
    },
  },
});
