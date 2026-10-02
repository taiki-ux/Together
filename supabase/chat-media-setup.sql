-- Run once in Supabase → SQL Editor (lets chat store photos, voice notes and files)
insert into storage.buckets (id, name, public) values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

create policy "chat media read" on storage.objects for select using (bucket_id = 'chat-media');
create policy "chat media upload" on storage.objects for insert with check (bucket_id = 'chat-media');
