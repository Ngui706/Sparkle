alter table public.customer_directory
  add column if not exists amount_owed numeric(12, 2) not null default 0
  check (amount_owed >= 0);

notify pgrst, 'reload schema';
