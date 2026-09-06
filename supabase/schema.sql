-- Together — run this once in Supabase → SQL Editor → New query → Run.
-- Creates the favorites (playlist) table with Row Level Security so each
-- signed-in user can only ever see and edit their own saved items.

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  kind text not null check (kind in ('video','music')),
  title text not null,
  video_id text not null,
  created_at timestamptz default now()
);

alter table public.favorites enable row level security;

create policy "Users manage their own favorites"
  on public.favorites
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists favorites_user_kind_idx on public.favorites (user_id, kind, created_at desc);
