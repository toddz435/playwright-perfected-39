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
import { decryptSecret } from "@/lib/secrets.server";

// DDT D2 (slice 2): re-pull a source-backed dataset's rows from its stored source_url (decrypting
// the stored REST token server-side). Overwrites columns/rows with the fresh data. Manual
// (spreadsheet/paste) datasets have no source_url and can't be refreshed.
export const Route = createFileRoute("/api/protected/refresh-dataset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { token: authToken } = await requireUser(request);
          const { datasetId } = await request.json();
          if (!datasetId) return json({ error: "datasetId required" }, { status: 400 });

          const sb = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            {
              global: { headers: { Authorization: `Bearer ${authToken}` } },
              auth: { persistSession: false, autoRefreshToken: false },
            },
          );

          const { data: ds, error } = await sb
            .from("datasets")
            .select("source, source_url, source_token")
            .eq("id", datasetId)
            .single();
          if (error && isMissingSourceColumn(error))
            return json({ error: MIGRATION_HINT }, { status: 400 });
          if (error || !ds) return json({ error: "Dataset not found" }, { status: 404 });

          const provider = ds.source as SourceProvider;
          if (!ds.source_url || (provider !== "sheet_url" && !isRestProvider(provider)))
            return json(
              { error: "This dataset isn't connected to a refreshable source." },
              { status: 400 },
            );

          let plain: string | undefined;
          if (isRestProvider(provider)) {
            if (!ds.source_token)
              return json({ error: "This source is missing its stored token." }, { status: 400 });
            try {
              plain = decryptSecret(ds.source_token);
            } catch {
              return json(
                { error: "Couldn't decrypt the stored token (SECRETS_KEY changed?)." },
                { status: 400 },
              );
            }
          }

          let data;
          try {
            data = await fetchSource({ provider, url: ds.source_url, token: plain });
          } catch (e: any) {
            return json({ error: friendlyFetchError(e) }, { status: 400 });
          }

          const { error: upErr } = await sb
            .from("datasets")
            .update({ columns: data.columns, rows: data.rows })
            .eq("id", datasetId);
          if (upErr) return json({ error: upErr.message }, { status: 400 });

          return json({ columns: data.columns, rows: data.rows, rowCount: data.rows.length });
        } catch (e: any) {
          if (e instanceof Response) return e;
          console.error(e);
          return json({ error: e?.message || "Failed" }, { status: 500 });
        }
      },
    },
  },
});
