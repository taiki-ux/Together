-- supabase/schema-favourites.sql
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- Favourites (the heart under queue items) live in the existing `favorites` table.
-- This does two small things:
--   1) one favourite per person per video/song (and tidies any accidental duplicates)
--   2) lets signed-in people see each other's favourites, because they're shown on profiles
--      (guests still can't read or write anything)

-- 1) remove duplicate rows (keeps the oldest of each), then enforce uniqueness
delete from public.favorites a
  using public.favorites b
  where a.user_id = b.user_id
    and a.kind = b.kind
    and a.video_id = b.video_id
    and a.id > b.id;

create unique index if not exists favorites_unique_per_user
  on public.favorites (user_id, kind, video_id);

-- 2) read access for signed-in people (writes are still limited to your own rows by the
--    existing "Users manage their own favorites" policy)
drop policy if exists "Signed-in users can read favourites" on public.favorites;
create policy "Signed-in users can read favourites"
  on public.favorites
  for select
  to authenticated
  using (true);
