-- supabase/schema-username.sql
--
-- OPTIONAL but recommended. Run once in the Supabase SQL editor.
-- The app works without it (it still shows a friendly message if a nickname is taken),
-- but this makes nicknames genuinely unique and lets the sign-up form say
-- "✓ That nickname is free" while you type.

-- 1) Make nicknames unique, ignoring upper/lower case.
--    If this errors with "could not create unique index", two accounts already share a
--    nickname. Find them with:
--      select lower(username), count(*) from public.profiles group by 1 having count(*) > 1;
--    rename one of each pair, then run this again.
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username));

-- 2) Let the sign-up form ask "is this nickname free?" before an account exists.
--    It only ever returns true/false — it never exposes anyone's profile.
create or replace function public.username_available(name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(trim(name))
  );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
