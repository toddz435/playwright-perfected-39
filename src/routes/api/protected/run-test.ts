import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { executeTest } from "@/lib/test-runner.server";
import { acquireSlot, ConcurrencyError, RUN_LIMITS } from "@/lib/concurrency.server";
import { BROWSER_CHOICES, type BrowserChoice } from "@/lib/playwright-runner.server";
import { quotaBlock } from "@/lib/quota.server";
import { runnerConfigured, delegateRun } from "@/lib/runner-client.server";

export const Route = createFileRoute("/api/protected/run-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token } = await requireUser(request);
          const { testId, resumeFromStep, watch, browser } = await request.json();
          if (!testId) return json({ error: "testId required" }, { status: 400 });

          // Cloud: hand execution to the Railway runner (the Worker can't run Playwright). The
          // runner re-validates the user token, enforces quota + concurrency, and runs headless.
          // `browser` IS forwarded — the cloud runner supports chromium/firefox/webkit (the bundled
          // engines); chrome/msedge channels aren't installed there and fail with a clear message.
          // `watch` is local-only (headed needs a display), so it's dropped.
          if (runnerConfigured()) {
            return await delegateRun(token, { testId, opts: { resumeFromStep, browser } });
          }

          // Local dev (no RUNNER_URL): run in-process on the Node server, where Playwright works.
          // `watch` = headed run so the user can see the browser. `browser` picks the engine;
          // ignore an unknown value rather than failing the run.
          const browserChoice: BrowserChoice | undefined = BROWSER_CHOICES.includes(browser)
            ? browser
            : undefined;

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

          // Monthly run quota (freemium). No-op while QUOTA_ENFORCED is off (meter + display only).
          const quota = await quotaBlock(sb);
          if (quota) return json({ error: quota }, { status: 429 });

          // Cap concurrent runs per user (and across the runner) so a user can't spawn
          // unbounded browsers. Throws ConcurrencyError (→ 429) when over the limit.
          const release = acquireSlot("run", userId, RUN_LIMITS);
          try {
            const { run } = await executeTest(sb, test, userId, {
              startIdx: Math.max(0, Number(resumeFromStep) || 0),
              headless: watch ? false : undefined,
              browser: browserChoice,
            });
            return json({ run });
          } finally {
            release();
          }
        } catch (e: any) {
          if (e instanceof Response) return e;
          if (e instanceof ConcurrencyError) return json({ error: e.message }, { status: 429 });
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
