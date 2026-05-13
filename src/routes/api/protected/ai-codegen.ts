import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { aiChat } from "@/lib/lovable-ai.server";

export const Route = createFileRoute("/api/protected/ai-codegen")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const { script } = await request.json();
          if (!script || typeof script !== "string") return json({ error: "script required" }, { status: 400 });

          const result = await aiChat({
            system: `You are an expert QA engineer. Convert raw Playwright recordings into RESILIENT Testrify test specs.
RULES:
- Replace ALL brittle CSS, XPath, and dynamic IDs with role/text/label/placeholder/testid/alt locators.
- Never keep auto-generated class names (e.g. .css-xxxx) or hash-suffixed IDs.
- Each step must be atomic and resumable.`,
            user: `Recorded script:
\`\`\`
${script}
\`\`\`

Convert it to a resilient Testrify spec.`,
            tool: {
              name: "emit_test_spec",
              description: "Emit a resilient Testrify browser test spec from the recording.",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  steps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        action: { type: "string", enum: ["goto", "click", "fill", "press", "wait", "expect_visible", "expect_text", "expect_url"] },
                        target: { type: "string", description: "Resilient locator: 'role:button[name=Submit]', 'text:Sign in', 'label:Email', 'placeholder:Search', 'testid:cart-total', or URL for goto/expect_url" },
                        value: { type: "string" },
                        rationale: { type: "string", description: "Why this locator is resilient" },
                      },
                      required: ["action", "target"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["name", "description", "steps"],
                additionalProperties: false,
              },
            },
          });
          return json(result);
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
