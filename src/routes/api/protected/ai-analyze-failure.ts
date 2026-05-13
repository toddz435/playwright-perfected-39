import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { aiChat } from "@/lib/lovable-ai.server";

export const Route = createFileRoute("/api/protected/ai-analyze-failure")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const { test, failedStep, error, allSteps } = await request.json();
          const result = await aiChat({
            system: `You are a senior QA engineer doing root-cause analysis on test failures. Be concise, specific, and actionable. Output GitHub-flavored markdown.`,
            user: `A test failed. Provide a root-cause analysis with a likely fix.

TEST: ${JSON.stringify(test).slice(0, 1500)}
FAILED STEP: ${JSON.stringify(failedStep).slice(0, 800)}
ERROR: ${error || "(no error message)"}

PRIOR STEPS:
${(allSteps || []).map((s: any, i: number) => `${i + 1}. [${s.status}] ${s.name || s.action} ${s.target || ""}`).join("\n")}

Respond with these sections:
### Likely cause
### Suggested fix
### Resume strategy`,
          });
          return json({ analysis: result });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
