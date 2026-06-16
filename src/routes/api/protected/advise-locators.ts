import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { hardenBrowserSteps } from "@/lib/harden.server";

// Phase E: read-only developer advice. Drives the browser test against the live site and
// returns recommendations to add stable handles (data-testid) wherever an element has no
// resilient locator. Does NOT modify the saved test.
export const Route = createFileRoute("/api/protected/advise-locators")({
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
            return json({ error: "Only browser tests can be analyzed" }, { status: 400 });

          const steps = (test.spec?.steps || []) as any[];
          if (steps.length === 0) return json({ error: "Test has no steps" }, { status: 400 });

          // Read-only: we run the hardening pass but discard the rewritten spec.
          const { advisories } = await hardenBrowserSteps(steps);
          return json({ advisories });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
