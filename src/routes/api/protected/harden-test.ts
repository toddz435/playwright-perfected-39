import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { hardenAndSaveTest } from "@/lib/harden.server";

// Phase C: drives the saved browser test through a real browser and rewrites its
// locators to validated, resilient ones (+ fallbacks), then saves the updated spec.
// This performs the test's actions against the live site to reach each step's DOM state.
export const Route = createFileRoute("/api/protected/harden-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { token } = await requireUser(request);
          const { testId } = await request.json();
          if (!testId) return json({ error: "testId required" }, { status: 400 });

          const SUPABASE_URL = process.env.SUPABASE_URL!;
          const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: test, error: tErr } = await sb
            .from("tests")
            .select("*")
            .eq("id", testId)
            .single();
          if (tErr || !test) return json({ error: "Test not found" }, { status: 404 });
          if (test.type !== "browser")
            return json({ error: "Only browser tests can be hardened" }, { status: 400 });

          if (((test.spec?.steps as any[]) || []).length === 0)
            return json({ error: "Test has no steps" }, { status: 400 });

          const { report, improved } = await hardenAndSaveTest(sb, test);
          return json({ report, improved });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
