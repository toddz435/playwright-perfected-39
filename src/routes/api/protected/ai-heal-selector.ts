import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { aiChat } from "@/lib/lovable-ai.server";

export const Route = createFileRoute("/api/protected/ai-heal-selector")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const { selector, context } = await request.json();
          if (!selector) return json({ error: "selector required" }, { status: 400 });
          if (String(selector).length > 10_000 || String(context || "").length > 10_000)
            return json({ error: "Input too large (max 10 KB per field)" }, { status: 413 });

          const result = await aiChat({
            system: `You are a Playwright selector expert. Convert brittle CSS/XPath/dynamic-id selectors into resilient role/text/label/testid locators.`,
            user: `Original selector (likely brittle):
${selector}

Context (optional, e.g. surrounding HTML or what the element does):
${context || "(none)"}

Return a resilient locator and explain why.`,
            tool: {
              name: "emit_healed_selector",
              description: "Return a healed, resilient selector.",
              parameters: {
                type: "object",
                properties: {
                  resilient: {
                    type: "string",
                    description:
                      "New locator in the form 'role:button[name=Submit]' or 'text:Sign in'",
                  },
                  rationale: { type: "string" },
                  fallbacks: {
                    type: "array",
                    items: { type: "string" },
                    description: "Up to 3 fallback locators",
                  },
                },
                required: ["resilient", "rationale"],
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
