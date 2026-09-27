create table if not exists public.attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null,
  staff_name text not null,
  staff_role text not null,
  duty_date date not null,
  check_in timestamptz not null,
  check_out timestamptz not null,
  created_at timestamptz not null default now(),
  constraint attendance_shifts_time_order check (check_out > check_in)
);

create index if not exists attendance_shifts_duty_date_idx
  on public.attendance_shifts (duty_date);

create index if not exists attendance_shifts_staff_date_idx
  on public.attendance_shifts (staff_id, duty_date);

create table if not exists public.attendance_weekly_recaps (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  recap jsonb not null,
  saved_at timestamptz not null default now(),
  constraint attendance_weekly_recaps_monday check (extract(isodow from week_start) = 1)
);