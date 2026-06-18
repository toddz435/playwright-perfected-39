import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";

// Promotes a run's captured "actual" screenshot to the new baseline for a screenshot step
// (used when a UI change is intentional). Owner-scoped: paths must live under the caller's
// own `{uid}/{testId}/` prefix, and the test must be readable by the RLS token client.
// Keep the baseline key in sync with runVisualDiffs (test-runner.server.ts).
export const Route = createFileRoute("/api/protected/update-baseline")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token } = await requireUser(request);
          const { testId, sid, idx, actualPath } = await request.json();
          if (!testId || typeof actualPath !== "string")
            return json({ error: "testId and actualPath required" }, { status: 400 });

          const baselineKey =
            sid != null ? `sid-${sid}` : `baseline-${Number(idx) || 0}`;
          const baselinePath = `${userId}/${testId}/${baselineKey}.png`;
          const prefix = `${userId}/${testId}/`;
          // The actual must belong to this user AND this test — no cross-test/user writes.
          if (!actualPath.startsWith(prefix))
            return json({ error: "forbidden path" }, { status: 403 });

          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });

          // Confirm the test is owned/readable by this caller (RLS) before touching storage.
          const { data: test, error: tErr } = await sb
            .from("tests")
            .select("id")
            .eq("id", testId)
            .single();
          if (tErr || !test) return json({ error: "Test not found" }, { status: 404 });

          const bucket = sb.storage.from("screenshots");
          const { data: dl, error: dlErr } = await bucket.download(actualPath);
          if (!dl) return json({ error: dlErr?.message || "actual not found" }, { status: 404 });
          const buf = Buffer.from(await dl.arrayBuffer());
          const up = await bucket.upload(
            baselinePath,
            new Blob([new Uint8Array(buf)], { type: "image/png" }),
            { contentType: "image/png", upsert: true },
          );
          if (up.error) return json({ error: up.error.message }, { status: 500 });

          return json({ ok: true, baselinePath });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
