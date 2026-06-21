import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/secrets.server";
import { buildTicketFromRun, createJiraIssue } from "@/lib/jira.server";

// PR #4: file a (failed) run as a Jira issue using the caller's saved Jira connection. The stored
// token is decrypted server-side only. Returns the new issue key + a browse URL.
export const Route = createFileRoute("/api/protected/create-jira-ticket")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { token: authToken } = await requireUser(request);
          const { testId, runId } = await request.json();
          if (!testId) return json({ error: "testId required" }, { status: 400 });

          const sb = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            {
              global: { headers: { Authorization: `Bearer ${authToken}` } },
              auth: { persistSession: false, autoRefreshToken: false },
            },
          );

          const { data: cfg } = await sb.from("jira_config").select("*").maybeSingle();
          if (!cfg)
            return json(
              { error: "No Jira connection — set it up in Integrations first." },
              { status: 400 },
            );

          let tokenPlain: string;
          try {
            tokenPlain = decryptSecret(cfg.token);
          } catch {
            return json(
              { error: "Couldn't read the stored Jira token — re-enter it in Integrations." },
              { status: 400 },
            );
          }

          const { data: test } = await sb.from("tests").select("*").eq("id", testId).single();
          if (!test) return json({ error: "Test not found" }, { status: 404 });

          // The specific run if given, else the test's most recent run.
          let run: any = null;
          if (runId) {
            run = (await sb.from("runs").select("*").eq("id", runId).maybeSingle()).data;
          } else {
            run = (
              await sb
                .from("runs")
                .select("*")
                .eq("test_id", testId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            ).data;
          }

          const ticket = buildTicketFromRun(test, run);
          try {
            const issue = await createJiraIssue(
              {
                baseUrl: cfg.base_url,
                email: cfg.email,
                projectKey: cfg.project_key,
                token: tokenPlain,
              },
              ticket,
            );
            return json(issue);
          } catch (e: any) {
            return json({ error: e?.message || "Could not create the Jira issue." }, { status: 400 });
          }
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
