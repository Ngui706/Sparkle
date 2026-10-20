-- Offers sent by staff can also be announced as an on-site popup.
create table if not exists public.promotion_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  message text not null check (char_length(message) between 1 and 2500),
  discount text,
  promo_code text,
  valid_until text,
  created_at timestamptz not null default now()
);

alter table public.promotion_announcements enable row level security;
drop policy if exists "Anyone can view promotion announcements" on public.promotion_announcements;
create policy "Anyone can view promotion announcements" on public.promotion_announcements
  for select to anon, authenticated using (true);
grant select on public.promotion_announcements to anon, authenticated;
grant all on public.promotion_announcements to service_role;

notify pgrst, 'reload schema';
