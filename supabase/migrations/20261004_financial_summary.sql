create table if not exists public.restaurant_financial_summaries (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  total_saldo numeric(18, 2) not null default 0 check (total_saldo >= 0),
  pembagian_gaji_nsn numeric(18, 2) not null default 0 check (pembagian_gaji_nsn >= 0),
  modal numeric(18, 2) not null default 0 check (modal >= 0),
  reimburse numeric(18, 2) not null default 0 check (reimburse >= 0),
  kerjasama_pesanan numeric(18, 2) not null default 0 check (kerjasama_pesanan >= 0),
  notes text not null default '' check (char_length(notes) <= 2000),
  income_ditarik numeric(18, 2) generated always as (greatest(0, pembagian_gaji_nsn - modal)) stored,
  income_bersih numeric(18, 2) generated always as (greatest(0, pembagian_gaji_nsn - modal - reimburse)) stored,
  operasional_60 numeric(18, 2) generated always as (greatest(0, pembagian_gaji_nsn - modal - reimburse) * 0.60) stored,
  owner_40 numeric(18, 2) generated always as (greatest(0, pembagian_gaji_nsn - modal - reimburse) * 0.40) stored,
  operasional_plus_kerjasama numeric(18, 2) generated always as (greatest(0, pembagian_gaji_nsn - modal - reimburse) * 0.60 + kerjasama_pesanan) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_restaurant_financial_summary_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists restaurant_financial_summaries_touch_updated_at on public.restaurant_financial_summaries;
create trigger restaurant_financial_summaries_touch_updated_at
  before update on public.restaurant_financial_summaries
  for each row execute function public.touch_restaurant_financial_summary_updated_at();

alter table public.restaurant_financial_summaries enable row level security;
revoke all on table public.restaurant_financial_summaries from anon, authenticated;
grant all on table public.restaurant_financial_summaries to service_role;
