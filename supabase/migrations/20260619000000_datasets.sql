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
