create table if not exists public.salary_allocation_settings (
  id text primary key,
  saldo_pool numeric not null default 0,
  salary_percent numeric not null default 80,
  hours_data jsonb not null default '{}'::jsonb,
  paid_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.salary_allocation_history (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  saldo_pool numeric not null default 0,
  salary_percent numeric not null default 80,
  bonus_percent numeric not null default 20,
  hours_data jsonb not null default '{}'::jsonb,
  paid_data jsonb not null default '{}'::jsonb,
  staff_count integer not null default 0,
  total numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.salary_allocation_settings enable row level security;
alter table public.salary_allocation_history enable row level security;

alter table public.salary_allocation_settings
  add column if not exists weight_data jsonb not null default '{}'::jsonb;

grant select, insert, update, delete on table public.salary_allocation_settings to anon, authenticated;
grant select, insert, update, delete on table public.salary_allocation_history to anon, authenticated;

drop policy if exists "Allow salary settings access" on public.salary_allocation_settings;
create policy "Allow salary settings access"
  on public.salary_allocation_settings for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow salary history access" on public.salary_allocation_history;
create policy "Allow salary history access"
  on public.salary_allocation_history for all
  to anon, authenticated
  using (true)
  with check (true);