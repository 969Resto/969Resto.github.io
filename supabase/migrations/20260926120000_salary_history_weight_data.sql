alter table public.salary_allocation_history
  add column if not exists weight_data jsonb not null default '{}'::jsonb;