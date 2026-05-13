
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
