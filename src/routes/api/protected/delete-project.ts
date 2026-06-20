import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { purgeTestStorage } from "@/lib/visual.server";

// VR-3: delete a project AND purge every one of its tests' visual-regression Storage objects, so
// nothing orphans in the screenshots bucket. Tests + runs cascade with the project; schedules have
// no FK to tests so are removed explicitly. Storage purges are best-effort (allSettled).
export const Route = createFileRoute("/api/protected/delete-project")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token } = await requireUser(request);
          const { projectId } = await request.json();
          if (!projectId) return json({ error: "projectId required" }, { status: 400 });

          const sb = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            {
              global: { headers: { Authorization: `Bearer ${token}` } },
              auth: { persistSession: false, autoRefreshToken: false },
            },
          );

          // RLS scopes these to the caller. Collect the project's tests BEFORE deleting, so we know
          // which Storage prefixes to purge (the cascade would otherwise erase the list).
          const { data: tests } = await sb
            .from("tests")
            .select("id")
            .eq("project_id", projectId);
          const testIds: string[] = (tests || []).map((t: any) => t.id);

          const bucket = sb.storage.from("screenshots");
          await Promise.allSettled(testIds.map((id) => purgeTestStorage(bucket, userId, id)));

          if (testIds.length) await sb.from("schedules").delete().in("test_id", testIds);
          const { error } = await sb.from("projects").delete().eq("id", projectId); // tests+runs cascade
          if (error) return json({ error: error.message }, { status: 400 });

          return json({ ok: true, purgedTests: testIds.length });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
