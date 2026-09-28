-- Foto de perfil do contato (WhatsApp) na lista do inbox
alter table public.conversations
  add column if not exists contact_avatar_url text;

comment on column public.conversations.contact_avatar_url is
  'URL da foto de perfil do contato no WhatsApp (Uazapi chat.image / chat/details).';
