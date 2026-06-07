import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { aiChat } from "@/lib/lovable-ai.server";

export const Route = createFileRoute("/api/protected/ai-generate-api-suite")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await requireUser(request);
          const { input } = await request.json();
          if (!input) return json({ error: "input required" }, { status: 400 });
          if (String(input).length > 10_000)
            return json({ error: "Input too large (max 10 KB)" }, { status: 413 });

          const result = await aiChat({
            system: `You are an expert API tester. Given a curl command, OpenAPI URL, or description, produce a runnable test suite with sensible assertions. Be safe — never include destructive verbs unless explicitly asked.`,
            user: `Build an API test suite from this input. Use the user's actual URL and headers if a curl is given. Add 2-5 assertions per request that grandma could understand (status code, response time, body contains expected field).

INPUT:
${input}`,
            tool: {
              name: "emit_api_suite",
              description: "Emit an API test suite spec.",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  requests: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
                        url: { type: "string" },
                        headers: { type: "object", additionalProperties: { type: "string" } },
                        body: { type: "string", description: "JSON-stringified body, or empty" },
                        assertions: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              kind: {
                                type: "string",
                                enum: [
                                  "status_eq",
                                  "status_lt",
                                  "time_lt_ms",
                                  "body_contains",
                                  "json_path_eq",
                                  "header_present",
                                ],
                              },
                              expected: {
                                type: "string",
                                description:
                                  "Expected value as string. For json_path_eq use 'path::value'.",
                              },
                              human: {
                                type: "string",
                                description: "Plain-English description grandma can read",
                              },
                            },
                            required: ["kind", "expected", "human"],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ["name", "method", "url", "assertions"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["name", "description", "requests"],
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
