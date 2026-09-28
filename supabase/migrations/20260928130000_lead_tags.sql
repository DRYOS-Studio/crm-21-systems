-- Tags simples por lead (conversa), catálogo isolado por conta.

create table if not exists public.lead_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default 'oak',
  created_at timestamptz not null default now(),
  constraint lead_tags_name_len check (char_length(btrim(name)) between 1 and 32),
  constraint lead_tags_color_chk check (color in ('oak', 'sage', 'ok', 'warning', 'neutral', 'critical'))
);

create unique index if not exists lead_tags_user_name_uidx
  on public.lead_tags (user_id, lower(btrim(name)));

create index if not exists lead_tags_user_idx on public.lead_tags (user_id);

alter table public.lead_tags enable row level security;
grant select, insert, update, delete on public.lead_tags to authenticated;
grant all on public.lead_tags to service_role;

drop policy if exists own_lead_tags on public.lead_tags;
create policy own_lead_tags on public.lead_tags
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.conversation_tags (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  tag_id uuid not null references public.lead_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, tag_id)
);

create index if not exists conversation_tags_tag_idx on public.conversation_tags (tag_id);

alter table public.conversation_tags enable row level security;
grant select, insert, delete on public.conversation_tags to authenticated;
grant all on public.conversation_tags to service_role;

drop policy if exists own_conversation_tags on public.conversation_tags;
create policy own_conversation_tags on public.conversation_tags
  for all to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
    and exists (
      select 1 from public.lead_tags t
      where t.id = tag_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
    and exists (
      select 1 from public.lead_tags t
      where t.id = tag_id and t.user_id = auth.uid()
    )
  );
