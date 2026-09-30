alter table public.conversations
  add column if not exists installation_at timestamptz,
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create table if not exists public.lead_custom_fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 48),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,47}$'),
  created_at timestamptz not null default now(),
  unique (user_id, field_key),
  unique (user_id, label)
);

alter table public.lead_custom_fields enable row level security;
grant select, insert, update, delete on public.lead_custom_fields to authenticated;
grant all on public.lead_custom_fields to service_role;
drop policy if exists org_lead_custom_fields on public.lead_custom_fields;
create policy org_lead_custom_fields on public.lead_custom_fields
  for all to authenticated
  using (public.same_org(user_id))
  with check (public.same_org(user_id));

create index if not exists conversations_installation_at_idx
  on public.conversations (installation_at) where installation_at is not null;
