alter table public.staff enable row level security;

grant select, insert, update, delete on table public.staff to anon, authenticated;

drop policy if exists "staff select" on public.staff;
create policy "staff select"
  on public.staff for select
  to anon, authenticated
  using (true);

drop policy if exists "staff insert" on public.staff;
create policy "staff insert"
  on public.staff for insert
  to anon, authenticated
  with check (true);

drop policy if exists "staff update" on public.staff;
create policy "staff update"
  on public.staff for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "staff delete" on public.staff;
create policy "staff delete"
  on public.staff for delete
  to anon, authenticated
  using (true);