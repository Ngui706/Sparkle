-- Staff and admins share management access for reviews and homepage ads.
drop policy if exists "Admins can manage reviews" on public.reviews;
drop policy if exists "Staff and admins can manage reviews" on public.reviews;
create policy "Staff and admins can manage reviews" on public.reviews for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('staff', 'admin')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('staff', 'admin')
  ));

-- The staff portal supports listing, creating, editing, publishing, and deleting ads.
drop policy if exists "Staff and admins can manage ads" on public.ads;
create policy "Staff and admins can manage ads" on public.ads for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('staff', 'admin')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('staff', 'admin')
  ));
grant select, insert, update, delete on public.ads to authenticated;

notify pgrst, 'reload schema';
