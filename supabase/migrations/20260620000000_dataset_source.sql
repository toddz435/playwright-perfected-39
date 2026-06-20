-- DDT D2 (slice 2): remember a dataset's external source so it can be RE-FETCHED ("Refresh from
-- source"), and support AUTHENTICATED REST sources (Airtable / Supabase). The existing `source`
-- column is the provider discriminator ('spreadsheet' | 'sheet_url' | 'airtable' | 'supabase').
--   source_url   — the endpoint to re-fetch (a published-CSV URL, or an Airtable/Supabase REST URL)
--   source_token — the connection token, AES-256-GCM ENCRYPTED at rest (enc:v1:… blob, keyed by the
--                  server-only SECRETS_KEY — same scheme as secret variables). NULL for public CSV.
-- Both nullable; existing rows (manual/paste/CSV-import datasets) keep working untouched. RLS is
-- already owner-scoped on `datasets`, and the token is ciphertext, so no policy change is needed.

alter table public.datasets
  add column if not exists source_url   text,
  add column if not exists source_token text;
