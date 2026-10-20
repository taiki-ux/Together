-- supabase/schema-room-playlist.sql
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- A "room playlist" item is a song or video someone saved while in a room.
--   * everyone in that room sees it (while they're in it)
--   * it also appears on the profile of the person who saved it
-- Guests (people without an account) never read or write this table.

create table if not exists public.room_playlist (
  id            uuid primary key default gen_random_uuid(),
  room_code     text        not null,
  kind          text        not null check (kind in ('video', 'music')),
  video_id      text        not null,
  title         text        not null,
  saved_by      uuid        not null references auth.users (id) on delete cascade,
  saved_by_name text,
  created_at    timestamptz not null default now()
);

-- one entry per person per song per room
create unique index if not exists room_playlist_unique
  on public.room_playlist (room_code, kind, video_id, saved_by);
create index if not exists room_playlist_room_idx
  on public.room_playlist (room_code, created_at);
create index if not exists room_playlist_user_idx
  on public.room_playlist (saved_by, created_at desc);

alter table public.room_playlist enable row level security;

-- You can only see, add and remove YOUR OWN rows directly (that's your profile list).
drop policy if exists "room_playlist_select_own" on public.room_playlist;
create policy "room_playlist_select_own" on public.room_playlist
  for select to authenticated using (saved_by = auth.uid());

drop policy if exists "room_playlist_insert_own" on public.room_playlist;
create policy "room_playlist_insert_own" on public.room_playlist
  for insert to authenticated with check (saved_by = auth.uid());

drop policy if exists "room_playlist_delete_own" on public.room_playlist;
create policy "room_playlist_delete_own" on public.room_playlist
  for delete to authenticated using (saved_by = auth.uid());

-- A room's shared playlist is read through this function, which needs the room code.
-- That means nobody can list every room's playlists; you have to know the room.
create or replace function public.room_playlist_for(code text)
returns setof public.room_playlist
language sql
security definer
set search_path = public
stable
as $$
  select * from public.room_playlist
  where room_code = code
  order by created_at asc
  limit 300;
$$;

revoke all on function public.room_playlist_for(text) from public;
grant execute on function public.room_playlist_for(text) to authenticated;
