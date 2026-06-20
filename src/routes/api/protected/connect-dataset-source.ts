import { createFileRoute } from "@tanstack/react-router";
import { requireUser, json } from "@/lib/server-auth.server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchSource,
  isRestProvider,
  friendlyFetchError,
  isMissingSourceColumn,
  MIGRATION_HINT,
  type SourceProvider,
} from "@/lib/dataset-source.server";
import { encryptSecret, decryptSecret, hasSecretsKey } from "@/lib/secrets.server";

// DDT D2 (slice 2): connect a dataset to an external source (a published-CSV URL, or an
// Airtable/Supabase REST endpoint), fetch it, and SAVE it — atomically. For REST providers the
// connection token is AES-256-GCM encrypted at rest (write-only: a blank token on an existing
// dataset keeps the stored one). Returns the fetched columns/rows; never returns the token.
export const Route = createFileRoute("/api/protected/connect-dataset-source")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, token: authToken } = await requireUser(request);
          const body = await request.json();
          const name = String(body?.name ?? "").trim();
          const provider = String(body?.provider ?? "") as SourceProvider;
          const url = String(body?.url ?? "").trim();
          const secret = typeof body?.token === "string" ? body.token.trim() : "";
          const datasetId = body?.datasetId ? String(body.datasetId) : null;

          if (!name) return json({ error: "Give the dataset a name." }, { status: 400 });
          if (provider !== "sheet_url" && !isRestProvider(provider))
            return json({ error: "Unknown source provider." }, { status: 400 });
          if (!url) return json({ error: "Enter the source URL." }, { status: 400 });

          const sb = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            {
              global: { headers: { Authorization: `Bearer ${authToken}` } },
              auth: { persistSession: false, autoRefreshToken: false },
            },
          );

          // Resolve the token to STORE (encrypted) and the PLAINTEXT to fetch with. REST providers
          // require a token; a blank token when editing keeps the existing (write-only) one.
          let storedToken: string | null = null;
          let plain = "";
          if (isRestProvider(provider)) {
            if (secret) {
              if (!hasSecretsKey())
                return json(
                  { error: "Server can't store credentials yet (SECRETS_KEY not configured)." },
                  { status: 500 },
                );
              storedToken = encryptSecret(secret);
              plain = secret;
            } else if (datasetId) {
              const { data: existing } = await sb
                .from("datasets")
                .select("source_token")
                .eq("id", datasetId)
                .single();
              storedToken = existing?.source_token ?? null;
              if (!storedToken)
                return json({ error: "This source needs an API token." }, { status: 400 });
              try {
                plain = decryptSecret(storedToken);
              } catch {
                return json(
                  { error: "Couldn't read the stored token — re-enter it (SECRETS_KEY changed?)." },
                  { status: 400 },
                );
              }
            } else {
              return json({ error: "This source needs an API token." }, { status: 400 });
            }
          }

          let data;
          try {
            data = await fetchSource({ provider, url, token: plain || undefined });
          } catch (e: any) {
            return json({ error: friendlyFetchError(e) }, { status: 400 });
          }

          const payload = {
            name,
            source: provider,
            source_url: url,
            source_token: storedToken, // null for public CSV
            columns: data.columns,
            rows: data.rows,
            owner_id: userId,
          };
          const res = datasetId
            ? await sb.from("datasets").update(payload).eq("id", datasetId).select("id").single()
            : await sb.from("datasets").insert(payload).select("id").single();
          if (res.error)
            return json(
              { error: isMissingSourceColumn(res.error) ? MIGRATION_HINT : res.error.message },
              { status: 400 },
            );

          return json({
            id: res.data.id,
            source: provider,
            columns: data.columns,
            rows: data.rows,
          });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
