import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { aiChat } from "@/lib/lovable-ai.server";

export const Route = createFileRoute("/api/protected/ai-generate-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const { prompt, baseUrl } = await request.json();
          if (!prompt || typeof prompt !== "string")
            return json({ error: "prompt required" }, { status: 400 });
          if (prompt.length > 10_000)
            return json({ error: "Prompt too large (max 10 KB)" }, { status: 413 });

          const result = await aiChat({
            system: `You are an expert QA engineer who writes resilient browser tests for a Playwright-based runtime called Vector QA.
RULES:
- Always prefer role/text/label-based locators over CSS or XPath.
- NEVER use brittle dynamic IDs (e.g. div[id="abc-123-xyz"]) or auto-generated class names.
- Locators must use one of: role, text, label, placeholder, testid, alt.
- Each step must be self-contained and resumable.
- Output 4-12 atomic steps.`,
            user: `Generate a resilient browser test for this scenario.

BASE URL: ${baseUrl || "(not provided)"}
SCENARIO: ${prompt}

Return a structured test spec.`,
            tool: {
              name: "emit_test_spec",
              description: "Emit a structured Vector QA browser test spec.",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Short test name (4-8 words)" },
                  description: { type: "string" },
                  steps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        action: {
                          type: "string",
                          enum: [
                            "goto",
                            "click",
                            "fill",
                            "press",
                            "wait",
                            "expect_visible",
                            "expect_text",
                            "expect_url",
                          ],
                        },
                        target: {
                          type: "string",
                          description:
                            "Resilient locator: 'role:button[name=Sign in]', 'text:Add to cart', 'label:Email', 'placeholder:Search', 'testid:cart-total'. For goto/expect_url use URL.",
                        },
                        value: {
                          type: "string",
                          description: "Optional value for fill/press/expect_text/expect_url",
                        },
                        rationale: {
                          type: "string",
                          description: "Why this locator is resilient (one short sentence)",
                        },
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
          return json({ error: "Internal server error" }, { status: 500 });
        }
      },
    },
  },
});
