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
