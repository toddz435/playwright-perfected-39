import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/server-auth.server";
import { protectedHandler } from "@/lib/api-handler.server";
import { aiChat } from "@/lib/lovable-ai.server";

export const Route = createFileRoute("/api/protected/ai-analyze-failure")({
  server: {
    handlers: {
      POST: protectedHandler(async ({ body }) => {
        const { test, failedStep, error, allSteps } = body;
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
      }),
    },
  },
});
