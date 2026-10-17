alter table public.staff_metadata
  add column if not exists staff_snapshot jsonb;

grant select, insert, update on table public.staff_metadata to anon, authenticated;

drop policy if exists "Allow staff metadata read" on public.staff_metadata;
create policy "Allow staff metadata read"
  on public.staff_metadata for select
  to anon, authenticated
  using (key in ('staff_last_update', 'attendance_staff_snapshot'));

drop policy if exists "Allow staff metadata insert" on public.staff_metadata;
create policy "Allow staff metadata insert"
  on public.staff_metadata for insert
  to anon, authenticated
  with check (key in ('staff_last_update', 'attendance_staff_snapshot'));

drop policy if exists "Allow staff metadata update" on public.staff_metadata;
create policy "Allow staff metadata update"
  on public.staff_metadata for update
  to anon, authenticated
  using (key in ('staff_last_update', 'attendance_staff_snapshot'))
  with check (key in ('staff_last_update', 'attendance_staff_snapshot'));
