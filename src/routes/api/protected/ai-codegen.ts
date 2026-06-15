import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { aiChat } from "@/lib/lovable-ai.server";
import { parseCodegen } from "@/lib/codegen-parse";
import { locatorLabel, type Locator } from "@/lib/locator";

// Phase B: deterministically parse the recorded script into structured steps (no LLM for
// the well-formed getBy* majority), then use the LLM only to (a) name the test and
// (b) suggest resilient replacements for the leftover brittle css/xpath locators.
export const Route = createFileRoute("/api/protected/ai-codegen")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const { script } = await request.json();
          if (!script || typeof script !== "string")
            return json({ error: "script required" }, { status: 400 });

          const parsed = parseCodegen(script);
          if (parsed.steps.length === 0)
            return json({ error: "No runnable steps found in the recording." }, { status: 400 });

          const steps = parsed.steps.map((s) => ({ ...s }));

          // Ask the LLM for a name/description and resilient upgrades for brittle locators.
          let name = "Recorded test";
          let description = "Imported from a Playwright recording.";
          try {
            const brittleList = parsed.brittle.map((i) => ({
              index: i,
              action: steps[i].action,
              value: steps[i].value,
              current: locatorLabel(steps[i].locator),
            }));
            const result = await aiChat({
              system: `You harden recorded Playwright tests. You are given already-parsed steps.
For each brittle css/xpath locator listed, suggest a MORE resilient locator
(testid > role+name > label > placeholder > text) ONLY if you can confidently infer it
from the selector, action, and value; otherwise omit that index (leave it as-is).
Never invent locators for steps that are not listed. Also produce a concise test name
and one-sentence description.`,
              user: `Parsed steps:\n${JSON.stringify(steps, null, 2)}\n\nBrittle locators to consider:\n${JSON.stringify(brittleList, null, 2)}`,
              tool: {
                name: "emit_codegen_result",
                description: "Name the test and suggest resilient locators for brittle steps.",
                parameters: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    hardened: {
                      type: "array",
                      description: "Resilient replacements for brittle step locators, by index.",
                      items: {
                        type: "object",
                        properties: {
                          index: { type: "number" },
                          locator: {
                            type: "object",
                            properties: {
                              by: {
                                type: "string",
                                enum: [
                                  "testid",
                                  "role",
                                  "label",
                                  "placeholder",
                                  "text",
                                  "css",
                                  "xpath",
                                ],
                              },
                              value: { type: "string" },
                              role: { type: "string" },
                              name: { type: "string" },
                            },
                            required: ["by"],
                            additionalProperties: false,
                          },
                        },
                        required: ["index", "locator"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["name", "description", "hardened"],
                  additionalProperties: false,
                },
              },
            });
            if (result?.name) name = result.name;
            if (result?.description) description = result.description;
            for (const h of result?.hardened || []) {
              const loc = normalizeLocator(h?.locator);
              if (loc && typeof h.index === "number" && steps[h.index]) {
                steps[h.index].locator = loc;
              }
            }
          } catch (e: any) {
            // LLM unavailable — keep deterministic steps (css locators rely on runtime heal).
            console.error("ai-codegen hardening skipped:", e?.message || e);
            const firstGoto = steps.find((s) => s.action === "goto")?.target;
            if (firstGoto) {
              try {
                name = `Test — ${new URL(firstGoto).hostname}`;
              } catch {
                /* keep default */
              }
            }
          }

          return json({ name, description, steps, unparsed: parsed.unparsed });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});

// Guards an LLM-suggested locator into a valid Locator, or null if malformed.
function normalizeLocator(loc: any): Locator | null {
  if (!loc || typeof loc.by !== "string") return null;
  switch (loc.by) {
    case "role":
      return loc.role
        ? { by: "role", role: loc.role, ...(loc.name ? { name: loc.name } : {}) }
        : null;
    case "testid":
    case "label":
    case "placeholder":
    case "text":
    case "css":
    case "xpath":
      return typeof loc.value === "string" ? { by: loc.by, value: loc.value } : null;
    default:
      return null;
  }
}
