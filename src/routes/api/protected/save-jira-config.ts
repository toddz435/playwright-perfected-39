import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import { encryptSecret, hasSecretsKey } from "@/lib/secrets.server";

// PR #4: save (upsert) the caller's Jira connection. The API token is encrypted at rest and
// write-only — a blank token on an existing config keeps the stored one.
export const Route = createFileRoute("/api/protected/save-jira-config")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token: authToken } = await requireUser(request);
          const body = await request.json();
          const baseUrl = String(body?.baseUrl ?? "").trim().replace(/\/+$/, "");
          const email = String(body?.email ?? "").trim();
          const projectKey = String(body?.projectKey ?? "").trim();
          const issueType = String(body?.issueType ?? "").trim() || "Bug";
          const secret = typeof body?.token === "string" ? body.token.trim() : "";

          if (!baseUrl || !email || !projectKey)
            return json({ error: "Base URL, email, and project key are all required." }, { status: 400 });
          if (!/^https?:\/\//i.test(baseUrl))
            return json({ error: "Base URL must start with http(s):// (e.g. https://you.atlassian.net)." }, { status: 400 });

          const sb = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            {
              global: { headers: { Authorization: `Bearer ${authToken}` } },
              auth: { persistSession: false, autoRefreshToken: false },
            },
          );

          // New token → encrypt; blank on an existing config → keep the stored one.
          let storedToken: string | null = null;
          if (secret) {
            if (!hasSecretsKey())
              return json(
                { error: "Server can't store credentials yet (SECRETS_KEY not configured)." },
                { status: 500 },
              );
            storedToken = encryptSecret(secret);
          } else {
            const { data: existing } = await sb
              .from("jira_config")
              .select("token")
              .eq("owner_id", userId)
              .maybeSingle();
            storedToken = existing?.token ?? null;
            if (!storedToken) return json({ error: "Enter your Jira API token." }, { status: 400 });
          }

          const { error } = await sb.from("jira_config").upsert({
            owner_id: userId,
            base_url: baseUrl,
            email,
            project_key: projectKey,
            issue_type: issueType,
            token: storedToken,
          });
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
