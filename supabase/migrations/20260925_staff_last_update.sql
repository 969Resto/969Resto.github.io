create table if not exists public.staff_metadata (
  key text primary key,
  updated_at timestamptz not null default now()
);

alter table public.staff_metadata enable row level security;

grant select, insert, update on table public.staff_metadata to anon, authenticated;

drop policy if exists "Allow staff metadata read" on public.staff_metadata;
create policy "Allow staff metadata read"
  on public.staff_metadata for select
  to anon, authenticated
  using (key = 'staff_last_update');

drop policy if exists "Allow staff metadata insert" on public.staff_metadata;
create policy "Allow staff metadata insert"
  on public.staff_metadata for insert
  to anon, authenticated
  with check (key = 'staff_last_update');

drop policy if exists "Allow staff metadata update" on public.staff_metadata;
create policy "Allow staff metadata update"
  on public.staff_metadata for update
  to anon, authenticated
  using (key = 'staff_last_update')
  with check (key = 'staff_last_update');

create or replace function public.touch_staff_last_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_metadata (key, updated_at)
  values ('staff_last_update', now())
  on conflict (key) do update set updated_at = excluded.updated_at;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_last_update_trigger on public.staff;
create trigger staff_last_update_trigger
after insert or update or delete on public.staff
for each row execute function public.touch_staff_last_update();

insert into public.staff_metadata (key, updated_at)
values ('staff_last_update', now())
on conflict (key) do nothing;
