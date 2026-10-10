create table if not exists public.logduty_weekly_history (
  week_start date primary key,
  week_end date not null,
  staff_count integer not null default 0,
  shift_count integer not null default 0,
  total_minutes integer not null default 0,
  staff jsonb not null default '[]'::jsonb,
  saved_at timestamptz not null default now()
);

alter table public.logduty_weekly_history enable row level security;

grant select, insert, update, delete on table public.logduty_weekly_history to anon, authenticated;

drop policy if exists "Log duty history access" on public.logduty_weekly_history;
create policy "Log duty history access"
  on public.logduty_weekly_history for all
  to anon, authenticated
  using (true)
  with check (true);
