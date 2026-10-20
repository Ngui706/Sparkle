-- Customer reviews are private until an administrator approves them.
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (char_length(comment) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create index if not exists reviews_status_created_at_idx on public.reviews(status, created_at desc);
alter table public.reviews enable row level security;
drop policy if exists "Anyone can read approved reviews" on public.reviews;
create policy "Anyone can read approved reviews" on public.reviews for select using (status = 'approved');
drop policy if exists "Customers can submit their own reviews" on public.reviews;
create policy "Customers can submit their own reviews" on public.reviews for insert to authenticated with check (auth.uid() = user_id and status = 'pending');
drop policy if exists "Admins can manage reviews" on public.reviews;
create policy "Admins can manage reviews" on public.reviews for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
grant select, insert, update, delete on public.reviews to anon, authenticated;

-- Keep the booking tied to its authenticated customer so the notification includes their email.
alter table public.bookings add column if not exists user_id uuid references auth.users(id) on delete set null;

-- Brevo is called only from this trusted database-triggered Edge Function.
create extension if not exists pg_net;
create or replace function public.sparkle_send_staff_notification(payload jsonb)
returns void language plpgsql security definer set search_path = public, vault, net, extensions as $$
declare
  endpoint text;
  webhook_secret text;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets where name = 'sparkle_notification_function_url' limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'sparkle_notification_webhook_secret' limit 1;
  if endpoint is null or webhook_secret is null then
    raise warning 'Sparkle email notification secrets are not configured in Supabase Vault';
    return;
  end if;
  perform net.http_post(
    url := endpoint,
    headers := jsonb_build_object('Content-Type','application/json','x-sparkle-webhook-secret',webhook_secret),
    body := payload,
    timeout_milliseconds := 10000
  );
end;
$$;

create or replace function public.sparkle_notify_new_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sparkle_send_staff_notification(jsonb_build_object(
    'event','account_created', 'name', coalesce(new.raw_user_meta_data->>'full_name','Customer'),
    'email', new.email, 'phone', new.raw_user_meta_data->>'phone', 'created_at', new.created_at
  ));
  return new;
end;
$$;
drop trigger if exists sparkle_account_created_email on auth.users;
create trigger sparkle_account_created_email after insert on auth.users
for each row execute function public.sparkle_notify_new_account();

create or replace function public.sparkle_notify_new_booking()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare customer_email text;
begin
  select email into customer_email from auth.users where id = new.user_id;
  perform public.sparkle_send_staff_notification(jsonb_build_object(
    'event','booking_created', 'name', new.customer_name, 'email', customer_email,
    'phone', new.phone, 'service', new.service_name, 'location', new.location,
    'preferred_date', new.preferred_date, 'created_at', new.created_at
  ));
  return new;
end;
$$;
drop trigger if exists sparkle_booking_created_email on public.bookings;
create trigger sparkle_booking_created_email after insert on public.bookings
for each row execute function public.sparkle_notify_new_booking();

revoke all on function public.sparkle_send_staff_notification(jsonb) from public, anon, authenticated;
revoke all on function public.sparkle_notify_new_account() from public, anon, authenticated;
revoke all on function public.sparkle_notify_new_booking() from public, anon, authenticated;
