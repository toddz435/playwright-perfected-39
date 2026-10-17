import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { runnerConfigured } from "@/lib/runner-client.server";
import { signLiveTicket, isValidLiveId } from "@/lib/live-ticket.server";

// Issues a short-lived pass to the cloud runner's WebSocket, bound to THIS user.
//   kind "watch" (default): live view of a run — the browser generates `liveId`, calls this, opens
//     the returned URL, then starts the run with the same liveId; the runner streams only to the
//     run's owner.
//   kind "record": an interactive cloud recording session (runner/record.ts); liveId names it.
// Local dev (no RUNNER_URL) → { local: true }: there "Watch" opens a headed browser and recording
// uses the local `playwright codegen` window instead.
const PATHS = { watch: "/live", record: "/record" } as const;

export const Route = createFileRoute("/api/protected/live-ticket")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId } = await requireUser(request);
          const { liveId, kind = "watch" } = await request.json();
          if (!isValidLiveId(liveId)) return json({ error: "invalid liveId" }, { status: 400 });
          if (kind !== "watch" && kind !== "record") {
            return json({ error: "invalid kind" }, { status: 400 });
          }
          if (!runnerConfigured()) return json({ local: true });

          const ticket = signLiveTicket(process.env.RUNNER_SECRET || "", userId, liveId, kind);
          const base = (process.env.RUNNER_URL || "").replace(/\/+$/, "").replace(/^http/, "ws");
          return json({
            url: `${base}${PATHS[kind as keyof typeof PATHS]}?t=${encodeURIComponent(ticket)}`,
          });
        } catch (e) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: "Failed" }, { status: 500 });
        }
      },
    },
  },
});
