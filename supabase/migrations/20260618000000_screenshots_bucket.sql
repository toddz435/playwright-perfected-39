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
