-- supabase/schema-profile-v2.sql
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- Adds profile pictures and cover colours:
--   * two new columns on `profiles` (plus bio/status, in case they weren't there yet)
--   * a public `avatars` storage bucket where each person can only write into their OWN folder
--   * sensible length/format limits so nobody can store junk in a profile
-- Email addresses are NOT stored in `profiles`; they stay private in your account.

alter table public.profiles add column if not exists avatar_url  text;
alter table public.profiles add column if not exists cover_color text;
alter table public.profiles add column if not exists bio        text;
alter table public.profiles add column if not exists status     text;

-- Limits for new and edited rows only (existing rows are left alone: NOT VALID)
do $$ begin
  alter table public.profiles add constraint profiles_bio_len    check (bio is null or char_length(bio) <= 160) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_status_len check (status is null or char_length(status) <= 60) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_cover_fmt  check (cover_color is null or cover_color ~ '^#[0-9a-fA-F]{6}$') not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_avatar_fmt check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 400)) not valid;
exception when duplicate_object then null; end $$;

-- Pictures live in a public bucket (anyone can view a picture, only you can change yours)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
