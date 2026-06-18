-- Visual regression: a PRIVATE storage bucket for baseline + per-run screenshots.
-- Objects are keyed under "{auth.uid()}/..." so RLS can scope access to the owner.

insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

-- Owner-scoped access: the first path segment must equal the requesting user's id.
create policy "screenshots_select_own" on storage.objects for select
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "screenshots_insert_own" on storage.objects for insert
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "screenshots_update_own" on storage.objects for update
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "screenshots_delete_own" on storage.objects for delete
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
