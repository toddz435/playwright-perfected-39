import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { runnerConfigured } from "@/lib/runner-client.server";
import { signLiveTicket, isValidLiveId } from "@/lib/live-ticket.server";

// Issues a short-lived live-view pass for a cloud run. The browser generates `liveId`, calls this,
// opens the returned WebSocket URL to the runner, then starts the run with the same liveId. The
// ticket binds liveId to THIS user, so the runner only streams a run to its owner.
// Local dev (no RUNNER_URL) → { local: true }: "Watch" there opens a real headed browser instead.
export const Route = createFileRoute("/api/protected/live-ticket")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId } = await requireUser(request);
          const { liveId } = await request.json();
          if (!isValidLiveId(liveId)) return json({ error: "invalid liveId" }, { status: 400 });
          if (!runnerConfigured()) return json({ local: true });

          const ticket = signLiveTicket(process.env.RUNNER_SECRET || "", userId, liveId);
          const base = (process.env.RUNNER_URL || "").replace(/\/+$/, "").replace(/^http/, "ws");
          return json({ url: `${base}/live?t=${encodeURIComponent(ticket)}` });
        } catch (e) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: "Failed" }, { status: 500 });
        }
      },
    },
  },
});
