-- Outreach P3 (T26 schema; T27 acrescenta as RPCs de reserva na mesma migration).
-- Idempotente: AC-C1 aplica 2×.

-- =============================================================================
-- 1. prospects
-- =============================================================================
create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  name text,
  company text,
  city text,
  extra jsonb not null default '{}'::jsonb,
  origem text,
  estado text not null default 'fila'
    check (estado in ('fila','abordado','respondeu','descartado','optout')),
  conversation_id uuid references public.conversations(id) on delete set null,
  tentativas integer not null default 0,
  proximo_toque date,
  optout boolean not null default false,
  ultima_falha_em timestamptz,
  ultima_falha_motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, phone)
);

create index if not exists prospects_user_estado_idx on public.prospects (user_id, estado);
create index if not exists prospects_conversation_idx on public.prospects (conversation_id)
  where conversation_id is not null;

create or replace function public.prospects_canon_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.phone = public.canon_phone(new.phone);
  if new.phone is null then
    raise exception 'prospects.phone inválido';
  end if;
  return new;
end;
$$;

drop trigger if exists prospects_canon_phone on public.prospects;
create trigger prospects_canon_phone
  before insert or update of phone on public.prospects
  for each row execute function public.prospects_canon_phone();

drop trigger if exists update_prospects_updated_at on public.prospects;
create trigger update_prospects_updated_at
  before update on public.prospects
  for each row execute function public.update_updated_at_column();

alter table public.prospects enable row level security;
revoke all on public.prospects from public, anon, authenticated;
grant select, delete on public.prospects to authenticated;
grant insert (user_id, phone, name, company, city, extra, origem) on public.prospects to authenticated;
grant update (name, company, city, extra) on public.prospects to authenticated;
grant all on public.prospects to service_role;

drop policy if exists own_prospects on public.prospects;
create policy own_prospects on public.prospects
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================================
-- 2. outreach_sends
-- =============================================================================
create table if not exists public.outreach_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  toque integer not null,
  status text not null check (status in ('reservado','enviado','incerto')),
  reserved_at timestamptz not null default now(),
  sent_at timestamptz,
  cadencia_aplicada boolean not null default false
);

create index if not exists outreach_sends_user_status_idx
  on public.outreach_sends (user_id, status, reserved_at desc);

alter table public.outreach_sends enable row level security;
revoke all on public.outreach_sends from public, anon, authenticated;
grant select on public.outreach_sends to authenticated;
grant all on public.outreach_sends to service_role;

drop policy if exists own_outreach_sends on public.outreach_sends;
create policy own_outreach_sends on public.outreach_sends
  for select to authenticated using (auth.uid() = user_id);

-- =============================================================================
-- 3. outreach_openers + save_openers
-- =============================================================================
create table if not exists public.outreach_openers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  active boolean not null default true,
  constraint outreach_openers_len_chk check (char_length(text) <= 120 and char_length(btrim(text)) > 0),
  constraint outreach_openers_no_link_chk check (
    text !~* '(https?://|www\.|wa\.me|\m[a-z0-9-]+\.(com|net|org|br|io|app|me)\M)'
  )
);

alter table public.outreach_openers enable row level security;
revoke all on public.outreach_openers from public, anon, authenticated;
grant select on public.outreach_openers to authenticated;
grant all on public.outreach_openers to service_role;

drop policy if exists own_outreach_openers on public.outreach_openers;
create policy own_outreach_openers on public.outreach_openers
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.save_openers(p_texts text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_company text;
begin
  if v_uid is null then
    raise exception 'save_openers: not authenticated';
  end if;
  if p_texts is null or coalesce(array_length(p_texts, 1), 0) < 2 then
    raise exception 'save_openers: precisa de pelo menos 2 variações';
  end if;
  select company_name into v_company from public.agent_configs where user_id = v_uid;
  if exists (
    select 1 from unnest(p_texts) as t(txt) where txt like '%{empresa}%'
  ) and coalesce(btrim(v_company), '') = '' then
    raise exception 'save_openers: {empresa} exige company_name';
  end if;
  delete from public.outreach_openers where user_id = v_uid;
  insert into public.outreach_openers (user_id, text, active)
  select v_uid, t, true from unnest(p_texts) as t;
end;
$$;

revoke all on function public.save_openers(text[]) from public, anon;
grant execute on function public.save_openers(text[]) to authenticated;

-- =============================================================================
-- 4. agent_configs + cron secret
-- =============================================================================
alter table public.agent_configs add column if not exists outreach_enabled boolean not null default false;
alter table public.agent_configs add column if not exists outreach_daily_cap integer not null default 40;
alter table public.agent_configs add column if not exists outreach_instance_id uuid references public.whatsapp_instances(id) on delete set null;
alter table public.agent_configs add column if not exists outreach_ramp_start date;
alter table public.agent_configs add column if not exists outreach_weekdays_only boolean not null default true;
alter table public.agent_configs add column if not exists outreach_saturday_morning boolean not null default false;
alter table public.agent_configs add column if not exists outreach_paused_reason text;
alter table public.agent_configs add column if not exists outreach_last_tick_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agent_configs_outreach_daily_cap_chk'
  ) then
    alter table public.agent_configs
      add constraint agent_configs_outreach_daily_cap_chk check (outreach_daily_cap >= 1);
  end if;
end $$;

insert into public.app_settings (key, value)
select 'outreach_cron_secret', encode(gen_random_bytes(24), 'hex')
where not exists (select 1 from public.app_settings where key = 'outreach_cron_secret');

-- =============================================================================
-- 5. Triggers de propagação (ADR-07) — só o próprio tenant
-- =============================================================================
create or replace function public.prospects_on_conversation_optout()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and coalesce(old.optout, false) = false and new.optout = true then
    update public.prospects
    set estado = 'optout', optout = true, proximo_toque = null
    where conversation_id = new.id
      and user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists prospects_on_conversation_optout on public.conversations;
create trigger prospects_on_conversation_optout
  after update of optout on public.conversations
  for each row execute function public.prospects_on_conversation_optout();

create or replace function public.prospects_on_inbound_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.direction = 'inbound' then
    update public.prospects
    set estado = 'respondeu', proximo_toque = null
    where conversation_id = new.conversation_id
      and user_id = new.user_id
      and estado not in ('optout', 'descartado');
  end if;
  return new;
end;
$$;

drop trigger if exists prospects_on_inbound_message on public.messages;
create trigger prospects_on_inbound_message
  after insert on public.messages
  for each row execute function public.prospects_on_inbound_message();
