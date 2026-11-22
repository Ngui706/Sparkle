create table if not exists public.customer_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  phone text not null check (char_length(trim(phone)) between 7 and 30),
  category text not null default 'new' check (category in ('new', 'regular', 'loyal', 'vip')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists customer_directory_name_idx
  on public.customer_directory (lower(name));
create index if not exists customer_directory_category_idx
  on public.customer_directory (category);

alter table public.customer_directory enable row level security;
drop policy if exists "Staff and admins can manage customer directory" on public.customer_directory;
create policy "Staff and admins can manage customer directory"
  on public.customer_directory
  for all
  to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('staff', 'admin')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('staff', 'admin')
  ));

grant select, insert, update, delete on public.customer_directory to authenticated;
notify pgrst, 'reload schema';
