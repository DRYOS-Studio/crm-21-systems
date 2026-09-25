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

-- =============================================================================
-- 6. RPCs do disparo (T27) — só service_role; p_user em toda leitura/escrita
-- =============================================================================

create or replace function public.outreach_day_stats(p_user uuid)
returns table (enviados integer, responderam integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  return query
  select
    count(*)::integer as enviados,
    count(*) filter (
      where exists (
        select 1
        from public.prospects p
        join public.messages m
          on m.conversation_id = p.conversation_id
         and m.user_id = p.user_id
         and m.direction = 'inbound'
         and m.created_at > s.sent_at
        where p.id = s.prospect_id
          and p.user_id = p_user
      )
    )::integer as responderam
  from public.outreach_sends s
  where s.user_id = p_user
    and s.status in ('enviado', 'incerto')
    and (s.sent_at at time zone 'America/Sao_Paulo')::date = v_hoje;
end;
$$;

revoke all on function public.outreach_day_stats(uuid) from public, anon, authenticated;
grant execute on function public.outreach_day_stats(uuid) to service_role;

create or replace function public.outreach_release(p_user uuid, p_send uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prospect uuid;
begin
  delete from public.outreach_sends
  where id = p_send
    and user_id = p_user
    and status = 'reservado'
  returning prospect_id into v_prospect;
  if v_prospect is not null and p_motivo is not null then
    update public.prospects
    set ultima_falha_em = now(),
        ultima_falha_motivo = left(p_motivo, 300)
    where id = v_prospect
      and user_id = p_user;
  end if;
end;
$$;

revoke all on function public.outreach_release(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.outreach_release(uuid, uuid, text) to service_role;

create or replace function public.outreach_mark_uncertain(
  p_user uuid, p_send uuid, p_proximo_toque date, p_tentativas integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send public.outreach_sends;
begin
  select * into v_send
  from public.outreach_sends
  where id = p_send and user_id = p_user
  for update;
  if not found then
    return;
  end if;

  update public.outreach_sends
  set status = 'incerto',
      sent_at = coalesce(sent_at, now()),
      cadencia_aplicada = true
  where id = p_send and user_id = p_user;

  if not coalesce(v_send.cadencia_aplicada, false) then
    update public.prospects
    set tentativas = p_tentativas,
        proximo_toque = case when p_tentativas >= 3 then null else p_proximo_toque end,
        estado = case when p_tentativas >= 3 then 'descartado' else 'abordado' end
    where id = v_send.prospect_id and user_id = p_user;
    update public.agent_configs
    set outreach_ramp_start = coalesce(
      outreach_ramp_start,
      (now() at time zone 'America/Sao_Paulo')::date
    )
    where user_id = p_user;
  end if;
end;
$$;

revoke all on function public.outreach_mark_uncertain(uuid, uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.outreach_mark_uncertain(uuid, uuid, date, integer)
  to service_role;

create or replace function public.outreach_mark_sent(
  p_user uuid, p_send uuid, p_proximo_toque date, p_tentativas integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send public.outreach_sends;
begin
  select * into v_send
  from public.outreach_sends
  where id = p_send and user_id = p_user
  for update;
  if not found then
    return;
  end if;

  update public.outreach_sends
  set status = 'enviado',
      sent_at = case when v_send.status = 'incerto' then coalesce(sent_at, now()) else now() end
  where id = p_send and user_id = p_user;

  -- Já era incerto: só troca o status. Cadência já aplicada não se reaplica.
  if v_send.status = 'incerto' then
    return;
  end if;

  update public.prospects
  set tentativas = p_tentativas,
      proximo_toque = case when p_tentativas >= 3 then null else p_proximo_toque end,
      estado = case when p_tentativas >= 3 then 'descartado' else 'abordado' end
  where id = v_send.prospect_id and user_id = p_user;

  update public.agent_configs
  set outreach_ramp_start = coalesce(
    outreach_ramp_start,
    (now() at time zone 'America/Sao_Paulo')::date
  )
  where user_id = p_user;
end;
$$;

revoke all on function public.outreach_mark_sent(uuid, uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.outreach_mark_sent(uuid, uuid, date, integer)
  to service_role;

create or replace function public.outreach_reserve(
  p_user uuid, p_teto integer, p_intervalo interval
)
returns table (send_id uuid, prospect jsonb, conversation jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.agent_configs;
  v_stale public.outreach_sends;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_count int;
  v_prospect public.prospects;
  v_conv public.conversations;
  v_stage uuid;
  v_msgs int;
  v_send_id uuid;
  v_toque int;
begin
  select * into v_cfg
  from public.agent_configs
  where user_id = p_user
  for update;
  if not found then
    return;
  end if;

  if v_cfg.outreach_instance_id is not null
     and not exists (
       select 1 from public.whatsapp_instances w
       where w.id = v_cfg.outreach_instance_id
         and w.user_id = p_user
     ) then
    return;
  end if;

  select * into v_stale
  from public.outreach_sends
  where user_id = p_user
    and status = 'reservado'
    and reserved_at < now() - interval '5 minutes'
  order by reserved_at
  limit 1
  for update;
  if found then
    update public.outreach_sends
    set status = 'incerto',
        sent_at = reserved_at,
        cadencia_aplicada = false
    where id = v_stale.id
    returning * into v_stale;
    select * into v_prospect from public.prospects
    where id = v_stale.prospect_id and user_id = p_user;
    if v_prospect.conversation_id is not null then
      select * into v_conv from public.conversations
      where id = v_prospect.conversation_id and user_id = p_user;
    end if;
    send_id := v_stale.id;
    prospect := to_jsonb(v_prospect);
    conversation := case when v_conv.id is not null then to_jsonb(v_conv) else null end;
    return next;
    return;
  end if;

  if exists (
    select 1 from public.outreach_sends
    where user_id = p_user and status = 'reservado'
  ) then
    return;
  end if;

  if exists (
    select 1 from public.outreach_sends
    where user_id = p_user
      and status in ('enviado', 'incerto')
      and sent_at is not null
      and sent_at > now() - p_intervalo
  ) then
    return;
  end if;

  select count(*) into v_count
  from public.outreach_sends
  where user_id = p_user
    and status in ('enviado', 'incerto', 'reservado')
    and (coalesce(sent_at, reserved_at) at time zone 'America/Sao_Paulo')::date = v_hoje;
  if v_count >= p_teto then
    return;
  end if;

  select id into v_stage
  from public.pipeline_stages
  where user_id = p_user
  order by position
  limit 1;

  for v_prospect in
    select p.*
    from public.prospects p
    where p.user_id = p_user
      and p.optout = false
      and (
        (p.estado = 'fila' and p.tentativas = 0)
        or (
          p.estado = 'abordado'
          and p.tentativas > 0
          and p.tentativas < 3
          and p.proximo_toque is not null
          and p.proximo_toque <= v_hoje
        )
      )
      and not exists (
        select 1 from public.outreach_sends s
        where s.prospect_id = p.id
          and (
            s.status = 'reservado'
            or (s.status = 'incerto' and s.cadencia_aplicada = false)
          )
      )
    order by p.created_at
    for update of p skip locked
  loop
    v_conv := null;

    if v_prospect.conversation_id is not null then
      select * into v_conv
      from public.conversations
      where id = v_prospect.conversation_id
        and user_id = p_user;
      if not found then
        continue;
      end if;
    else
      select * into v_conv
      from public.conversations
      where user_id = p_user
        and contact_phone = v_prospect.phone;
      if found then
        select count(*) into v_msgs
        from public.messages
        where conversation_id = v_conv.id;
        if v_msgs > 0 then
          update public.prospects
          set estado = 'descartado', proximo_toque = null
          where id = v_prospect.id and user_id = p_user;
          continue;
        end if;
        update public.prospects
        set conversation_id = v_conv.id
        where id = v_prospect.id and user_id = p_user
        returning * into v_prospect;
        update public.conversations
        set instance_id = coalesce(instance_id, v_cfg.outreach_instance_id),
            stage_id = coalesce(stage_id, v_stage)
        where id = v_conv.id and user_id = p_user
        returning * into v_conv;
      else
        insert into public.conversations (
          user_id, contact_phone, wa_phone, ai_stage, ai_enabled, instance_id, stage_id
        ) values (
          p_user, v_prospect.phone, v_prospect.phone, 'abordar', true,
          v_cfg.outreach_instance_id, v_stage
        )
        returning * into v_conv;
        update public.prospects
        set conversation_id = v_conv.id
        where id = v_prospect.id and user_id = p_user
        returning * into v_prospect;
      end if;
    end if;

    if v_conv.ai_enabled = false then
      update public.prospects
      set estado = 'respondeu', proximo_toque = null
      where id = v_prospect.id and user_id = p_user;
      continue;
    end if;

    v_toque := v_prospect.tentativas + 1;
    insert into public.outreach_sends (user_id, prospect_id, toque, status)
    values (p_user, v_prospect.id, v_toque, 'reservado')
    returning id into v_send_id;

    send_id := v_send_id;
    prospect := to_jsonb(v_prospect);
    conversation := to_jsonb(v_conv);
    return next;
    return;
  end loop;
end;
$$;

revoke all on function public.outreach_reserve(uuid, integer, interval)
  from public, anon, authenticated;
grant execute on function public.outreach_reserve(uuid, integer, interval)
  to service_role;
