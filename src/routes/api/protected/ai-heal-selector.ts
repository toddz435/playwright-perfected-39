import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/server-auth.server";
import { protectedHandler } from "@/lib/api-handler.server";
import { aiChat } from "@/lib/lovable-ai.server";

export const Route = createFileRoute("/api/protected/ai-heal-selector")({
  server: {
    handlers: {
      POST: protectedHandler(async ({ body }) => {
        const { selector, context } = body;
        if (!selector) return json({ error: "selector required" }, { status: 400 });

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
                resilient: { type: "string", description: "New locator in the form 'role:button[name=Submit]' or 'text:Sign in'" },
                rationale: { type: "string" },
                fallbacks: { type: "array", items: { type: "string" }, description: "Up to 3 fallback locators" },
              },
              required: ["resilient", "rationale"],
              additionalProperties: false,
            },
          },
        });
        return json(result);
      }),
    },
  },
});
