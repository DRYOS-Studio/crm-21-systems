-- Inbox Kommo/Clint: anexos, áudio e figurinha nas mensagens.

alter table public.messages
  add column if not exists media_type text,
  add column if not exists media_url text,
  add column if not exists media_name text;

alter table public.messages drop constraint if exists messages_media_type_check;
alter table public.messages
  add constraint messages_media_type_check
  check (
    media_type is null
    or media_type in ('image', 'video', 'audio', 'ptt', 'sticker', 'document')
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-media', 'chat-media', true, 16777216)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "chat_media_insert_own" on storage.objects;
create policy "chat_media_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "chat_media_select_own" on storage.objects;
create policy "chat_media_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-media'
  and split_part(name, '/', 1) = auth.uid()::text
);
