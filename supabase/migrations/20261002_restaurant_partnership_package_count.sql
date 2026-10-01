alter table public.restaurant_partnerships
  add column if not exists package_count integer
  check (package_count between 1 and 100000);
