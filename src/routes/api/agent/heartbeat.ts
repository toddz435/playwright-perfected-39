import { createFileRoute } from "@tanstack/react-router";
import { requireAgentKey } from "@/lib/agent-auth.server";
import { json } from "@/lib/server-auth.server";

export const Route = createFileRoute("/api/agent/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          requireAgentKey(request);
          return json({ ok: true, ts: new Date().toISOString() });
        } catch (e) {
          if (e instanceof Response) return e;
          return json({ error: (e as Error)?.message || "Internal error" }, { status: 500 });
        }
      },
    },
  },
});
