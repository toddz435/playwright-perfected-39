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

          const result = await aiChat({
            system: `You are a Playwright selector expert. Convert a brittle CSS/XPath/dynamic-id selector into a more resilient one. Return a selector that page.locator() can use DIRECTLY: either a stable CSS selector or a Playwright text= selector (e.g. "text=Sign in"). Prefer stable attributes (id, name, type, data-testid, aria-label). Do NOT use role:/text: prefixes.`,
            user: `Original selector (likely brittle):
${selector}

Context (optional, e.g. surrounding HTML or what the element does):
${context || "(none)"}

Return a resilient locator and explain why.`,
            tool: {
              name: "emit_healed_selector",
              description: "Return a healed selector usable by page.locator().",
              parameters: {
                type: "object",
                properties: {
                  resilient: {
                    type: "string",
                    description:
                      'A single selector usable by page.locator() — CSS or Playwright text= engine (e.g. "text=Sign in").',
                  },
                  rationale: { type: "string" },
                  fallbacks: {
                    type: "array",
                    items: { type: "string" },
                    description: "Up to 3 fallback selectors, same format",
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
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
