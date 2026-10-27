create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  kind text not null check (kind in ('income', 'expense')),
  description text not null check (char_length(description) between 1 and 200),
  amount numeric(12, 2) not null check (amount > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists finance_entries_entry_date_idx on public.finance_entries(entry_date desc);
alter table public.finance_entries enable row level security;
drop policy if exists "Staff and admins can manage finance entries" on public.finance_entries;
create policy "Staff and admins can manage finance entries" on public.finance_entries for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('staff', 'admin')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('staff', 'admin')
  ));
grant select, insert, update, delete on public.finance_entries to authenticated;
notify pgrst, 'reload schema';
