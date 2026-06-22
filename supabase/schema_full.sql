-- Testrify — complete schema for a fresh (owned) Supabase project.
-- Assembled from the repo migrations, cron-free (the pg_cron scheduled-runs job that was
-- hard-wired to the old Lovable URL/anon key is intentionally omitted — rewire after deploy).
-- Paste this whole file into the new project's SQL editor and Run.

-- ===== core: profiles, projects, tests, runs, functions, triggers, RLS =====

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

-- updated_at trigger function
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

-- handle new user
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end; $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  base_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;
create index projects_owner_idx on public.projects(owner_id);

create policy "projects_all_own" on public.projects for all
using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();

-- tests
create type public.test_type as enum ('browser','api');

create table public.tests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  type public.test_type not null,
  spec jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tests enable row level security;
create index tests_project_idx on public.tests(project_id);
create index tests_owner_idx on public.tests(owner_id);

create policy "tests_all_own" on public.tests for all
using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create trigger tests_set_updated_at before update on public.tests
for each row execute function public.set_updated_at();

-- runs
create type public.run_status as enum ('queued','running','passed','failed','error');

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status public.run_status not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  summary jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  ai_analysis text,
  created_at timestamptz not null default now()
);
alter table public.runs enable row level security;
create index runs_test_idx on public.runs(test_id);
create index runs_owner_idx on public.runs(owner_id);
create index runs_created_idx on public.runs(created_at desc);

create policy "runs_all_own" on public.runs for all
using (auth.uid() = owner_id) with check (auth.uid() = owner_id);


create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ===== schedules table (cron job omitted) =====
-- Schedules table for cron-triggered test runs
CREATE TABLE public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  test_id uuid NOT NULL,
  cron text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedules_all_own" ON public.schedules
  FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER set_updated_at_schedules
BEFORE UPDATE ON public.schedules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_schedules_due ON public.schedules (enabled, next_run_at);


-- ===== screenshots storage bucket + policies =====
-- Visual regression: a PRIVATE storage bucket for baseline + per-run screenshots.
-- Objects are keyed under "{auth.uid()}/..." so RLS can scope access to the owner.

insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

-- Owner-scoped access: the first path segment must equal the requesting user's id.
-- `drop ... if exists` keeps this migration safely re-runnable (Postgres has no
-- `create policy if not exists`).
drop policy if exists "screenshots_select_own" on storage.objects;
create policy "screenshots_select_own" on storage.objects for select
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "screenshots_insert_own" on storage.objects;
create policy "screenshots_insert_own" on storage.objects for insert
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

-- UPDATE needs BOTH `using` (which existing rows you may target) and `with check`
-- (what the new row may become) — without `with check` a user could rename their
-- object into another owner's "{uid}/..." prefix (cross-tenant write).
drop policy if exists "screenshots_update_own" on storage.objects;
create policy "screenshots_update_own" on storage.objects for update
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "screenshots_delete_own" on storage.objects;
create policy "screenshots_delete_own" on storage.objects for delete
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== datasets =====
-- Data-Driven Testing: a `datasets` table holding tabular data (columns + rows) that drives a
-- test once per row. Stored in the database (persistent, owner-scoped) and edited spreadsheet-
-- style. `source` is the origin ('spreadsheet' now; 'sheet_url' / 'rest_url' / future 'database'
-- later) so the model supports a spreadsheet OR a database source without changing schema.
-- `rows` is a JSON array of {column: value} objects; `columns` keeps display/order.

create table if not exists public.datasets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null,
  source text not null default 'spreadsheet',
  columns text[] not null default '{}',
  rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.datasets enable row level security;

-- Owner-scoped: a user can only see/modify their own datasets.
drop policy if exists "datasets_all_own" on public.datasets;
create policy "datasets_all_own" on public.datasets for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create index if not exists datasets_owner_idx on public.datasets(owner_id);
create index if not exists datasets_project_idx on public.datasets(project_id);

drop trigger if exists datasets_set_updated_at on public.datasets;
create trigger datasets_set_updated_at before update on public.datasets
  for each row execute function public.set_updated_at();

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

-- ===== jira_config =====
-- PR #4: per-user Jira connection so a failed run can be filed as a Jira ticket. One row per user
-- (owner_id is the PK). The API token is AES-256-GCM ENCRYPTED at rest (enc:v1:… blob, keyed by
-- the server-only SECRETS_KEY — same scheme as secret variables / dataset source tokens); it is
-- write-only (never sent back to the client). RLS is owner-scoped.

create table if not exists public.jira_config (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  base_url text not null,        -- e.g. https://your-company.atlassian.net
  email text not null,           -- Atlassian account email (Basic auth: email:apiToken)
  project_key text not null,     -- e.g. BUG
  token text not null,           -- ENCRYPTED Jira API token
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jira_config enable row level security;

drop policy if exists "jira_config_all_own" on public.jira_config;
create policy "jira_config_all_own" on public.jira_config for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop trigger if exists set_updated_at_jira_config on public.jira_config;
create trigger set_updated_at_jira_config before update on public.jira_config
  for each row execute function public.set_updated_at();

-- Polish: let the user choose the Jira issue type to file (some projects have no "Bug" type).
-- Defaults to 'Bug' so existing configs keep working.
alter table public.jira_config
  add column if not exists issue_type text not null default 'Bug';

-- ===== API role grants =====
-- Expose public-schema objects to Supabase's API roles. RLS still enforces per-user row security,
-- so these table-level grants are safe. (Pasting raw SQL into a fresh project doesn't always trigger
-- Supabase's automatic grants, so we make them explicit.)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
