-- supabase/schema-rooms-presence.sql
--
-- Phase 8: Rooms + Presence. Run once against your Supabase project,
-- alongside your existing schema.sql.

-- Two new fields on rooms.
alter table rooms add column if not exists icon text default '🎬';
alter table rooms add column if not exists privacy text not null default 'open' check (privacy in ('open','private'));

-- IMPORTANT: this is what actually makes privacy work. Room codes are
-- 24-char random hex — practically unguessable — so looking a room up BY
-- its exact code isn't sensitive, but your existing `rooms` SELECT policy
-- was presumably scoped to `owner_id = auth.uid()` only (matching how
-- favorites/activity_log started out private-by-default), which means
-- anyone who ISN'T the owner can't currently read a room's privacy flag
-- at all — resolveRequireApproval() in rooms.js would silently treat
-- every room as "not found" → open, defeating privacy entirely for
-- everyone except the owner. This widens read access to anyone (signed
-- in or not), same reasoning as the `profiles` policy from Phase 5.
create policy "Anyone can look up a room by its code"
  on rooms for select
  using (true);

-- Remembers who's been approved into a private room, so a signed-in
-- person only has to knock once. Guests (not signed in) have no stable
-- identity to remember them by, so they always knock.
create table if not exists room_members (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (room_code, user_id)
);

alter table room_members enable row level security;

create policy "Users can check their own membership"
  on room_members for select
  using (auth.uid() = user_id);

create policy "Room owner can view their room's members"
  on room_members for select
  using (exists (select 1 from rooms r where r.code = room_members.room_code and r.owner_id = auth.uid()));

create policy "Room owner can add members"
  on room_members for insert
  with check (exists (select 1 from rooms r where r.code = room_members.room_code and r.owner_id = auth.uid()));

create policy "Room owner can remove members"
  on room_members for delete
  using (exists (select 1 from rooms r where r.code = room_members.room_code and r.owner_id = auth.uid()));
