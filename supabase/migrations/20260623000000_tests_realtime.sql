-- Live dashboard: broadcast `tests` changes over Supabase Realtime so a newly-recorded test (e.g.
-- one uploaded by the `testrify` CLI) shows up in an already-open dashboard with no manual refresh.
--
-- RLS on public.tests still applies to Realtime (postgres_changes), so each subscriber only
-- receives rows they can SELECT — i.e. their own (owner_id = auth.uid()). No cross-tenant leakage.
--
-- Idempotent: some Supabase projects already have `tests` in the supabase_realtime publication, and
-- a bare `alter publication ... add table` errors (42710) if it's already a member — so guard it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tests'
  ) then
    alter publication supabase_realtime add table public.tests;
  end if;
end $$;
