alter table public.restaurant_partnerships
  drop constraint if exists restaurant_partnerships_package_count_check;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'restaurant_partnerships'
      and column_name = 'package_count'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'restaurant_partnerships'
      and column_name = 'package_range'
  ) then
    alter table public.restaurant_partnerships rename column package_count to package_range;
  end if;
end;
$$;

alter table public.restaurant_partnerships
  alter column package_range type text using package_range::text;

alter table public.restaurant_partnerships
  drop constraint if exists restaurant_partnerships_package_range_length_check;

alter table public.restaurant_partnerships
  add constraint restaurant_partnerships_package_range_length_check
  check (package_range is null or char_length(btrim(package_range)) between 1 and 20);
