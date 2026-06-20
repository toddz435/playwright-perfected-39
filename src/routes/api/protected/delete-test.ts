import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { purgeTestStorage } from "@/lib/visual.server";

// VR-3: delete a test AND purge its visual-regression Storage objects (baselines + captures) so
// they don't orphan in the screenshots bucket. Schedules are removed explicitly (no FK); runs
// cascade with the test row. Storage purge is best-effort — a Storage hiccup must not block delete.
export const Route = createFileRoute("/api/protected/delete-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token } = await requireUser(request);
          const { testId } = await request.json();
          if (!testId) return json({ error: "testId required" }, { status: 400 });

          const sb = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            {
              global: { headers: { Authorization: `Bearer ${token}` } },
              auth: { persistSession: false, autoRefreshToken: false },
            },
          );

          // RLS scopes this to the caller's own rows — a missing row means not-found (or not theirs).
          const { data: t } = await sb.from("tests").select("id").eq("id", testId).single();
          if (!t) return json({ error: "Test not found" }, { status: 404 });

          // Purge BEFORE the row delete (the owner/test path is the same either way). Best-effort.
          try {
            await purgeTestStorage(sb.storage.from("screenshots"), userId, testId);
          } catch (e: any) {
            console.error("purge test storage failed:", e?.message || e);
          }

          await sb.from("schedules").delete().eq("test_id", testId);
          const { error } = await sb.from("tests").delete().eq("id", testId);
          if (error) return json({ error: error.message }, { status: 400 });

          return json({ ok: true });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
