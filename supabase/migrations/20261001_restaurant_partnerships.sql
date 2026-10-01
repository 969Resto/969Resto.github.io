create table if not exists public.restaurant_partnerships (
  id uuid primary key default gen_random_uuid(),
  partner_name text not null check (char_length(partner_name) between 1 and 160),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  delivery_required boolean not null default false,
  delivery_schedule text not null default '' check (char_length(delivery_schedule) <= 300),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not delivery_required or char_length(btrim(delivery_schedule)) > 0)
);

create index if not exists restaurant_partnerships_status_period_idx
  on public.restaurant_partnerships (status, starts_on desc);

create or replace function public.touch_restaurant_partnership_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists restaurant_partnerships_touch_updated_at on public.restaurant_partnerships;
create trigger restaurant_partnerships_touch_updated_at
  before update on public.restaurant_partnerships
  for each row execute function public.touch_restaurant_partnership_updated_at();

alter table public.restaurant_partnerships enable row level security;
revoke all on table public.restaurant_partnerships from anon, authenticated;
grant all on table public.restaurant_partnerships to service_role;
