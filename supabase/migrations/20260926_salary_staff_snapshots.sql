alter table public.salary_allocation_settings
  add column if not exists staff_data jsonb;

alter table public.salary_allocation_history
  add column if not exists staff_data jsonb;