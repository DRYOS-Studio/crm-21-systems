alter table public.conversations
  add column if not exists lead_context text;
