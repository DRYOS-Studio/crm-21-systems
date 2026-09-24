-- Cérebro de IA (P1/P2) — design.md §3.1. Substitui o rascunho
-- supabase/migrations/20260924020000_ai_brain.sql (apagado em T8): mesmas colunas, mas
-- (a) backfill de ai_stage correto por marcador (AC-A18b — o rascunho preenchia tudo com
-- 'abordar', quebrando os leads que já responderam) e (b) knowledge_base idempotente
-- (o rascunho tinha `create table` sem `if not exists`, falha na 2ª aplicação — AC-C1).
--
-- Regras comuns (design.md §3.0): create/drop com guarda; backfill por marcador em
-- private.q7_markers (não por "coluna acabou de nascer" — vale mesmo se o rascunho já rodou
-- e as colunas já existem); toda função nova SECURITY DEFINER usa search_path='' e nomes
-- qualificados, revoke de public/anon/authenticated + grant a service_role (exceções
-- nomeadas uma a uma).

-- =============================================================================
-- 0. private.q7_markers
-- =============================================================================
create table if not exists private.q7_markers (
  key text primary key,
  at timestamptz not null default now()
);

alter table private.q7_markers enable row level security;
revoke all on private.q7_markers from anon, authenticated;

-- =============================================================================
-- 1. agent_configs
-- =============================================================================
alter table public.agent_configs
  add column if not exists business_context text,
  add column if not exists owner_notify_phone text,
  add column if not exists company_name text;

-- =============================================================================
-- 2. conversations — ai_stage, qualification, confirmacoes, optout
-- =============================================================================
alter table public.conversations
  add column if not exists ai_stage text not null default 'abordar',
  add column if not exists qualification jsonb not null default '{}',
  add column if not exists confirmacoes integer not null default 0,
  add column if not exists ai_summary text,
  add column if not exists optout boolean not null default false,
  add column if not exists optout_motivo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_ai_stage_chk') then
    alter table public.conversations
      add constraint conversations_ai_stage_chk
      check (ai_stage in ('abordar', 'romper', 'descobrir', 'qualificar', 'convidar', 'descartar'));
  end if;
end $$;

-- AC-A18b: conversas existentes cuja 1ª mensagem é inbound viram 'descobrir'; as demais (sem
-- mensagem, ou iniciadas por nós) ficam no default 'abordar'. Guarda extra `ai_stage = 'abordar'`:
-- só mexe em quem ainda está no valor de nascença, nunca pisa em progresso real do cérebro.
do $$
begin
  if not exists (select 1 from private.q7_markers where key = 'ai_brain.ai_stage') then
    with primeira as (
      select distinct on (conversation_id) conversation_id, direction
      from public.messages
      order by conversation_id, created_at asc, id asc
    )
    update public.conversations c
    set ai_stage = 'descobrir'
    from primeira p
    where p.conversation_id = c.id
      and p.direction = 'inbound'
      and c.ai_stage = 'abordar';

    insert into private.q7_markers (key) values ('ai_brain.ai_stage');
  end if;
end $$;

-- =============================================================================
-- 3. messages — processed_at (D5, ADR-03/ADR-12), external_id (ADR-05)
-- =============================================================================
-- SEM default no add column: o fast-default do PG carimbaria toda linha antiga com a hora
-- deste ALTER, e o backfill abaixo (que grava processed_at = created_at) não acharia nada pra
-- corrigir (fool r3 W6). Ordem: add sem default → backfill → só então default now().
alter table public.messages
  add column if not exists processed_at timestamptz,
  add column if not exists external_id text;

do $$
begin
  if not exists (select 1 from private.q7_markers where key = 'ai_brain.processed_at') then
    update public.messages set processed_at = created_at where processed_at is null;
    insert into private.q7_markers (key) values ('ai_brain.processed_at');
  end if;
end $$;

-- ADR-12: só o webhook novo (T15) grava inbound com processed_at explicitamente nulo; quem não
-- conhece a coluna (webhook antigo, UI, Extrator, outbound) passa a gravar "já processada".
alter table public.messages alter column processed_at set default now();

create unique index if not exists messages_conv_external_uidx
  on public.messages (conversation_id, external_id)
  where external_id is not null;

create index if not exists messages_pending_idx
  on public.messages (conversation_id)
  where direction = 'inbound' and processed_at is null;

-- =============================================================================
-- 4. knowledge_base (AC-U2)
-- =============================================================================
create table if not exists public.knowledge_base (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  title text,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, topic)
);

alter table public.knowledge_base enable row level security;
revoke all on public.knowledge_base from anon, authenticated;
grant select, insert, update, delete on public.knowledge_base to authenticated;
grant all on public.knowledge_base to service_role;

drop policy if exists own_knowledge_base on public.knowledge_base;
create policy own_knowledge_base on public.knowledge_base
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trigger BEFORE ROW comum (não é RPC chamável isolada, roda dentro do INSERT/UPDATE já sujeito
-- à RLS da tabela) — segue o mesmo padrão já em uso em public.update_updated_at_column(), sem
-- revoke/grant de EXECUTE: não é a classe de função que o §3.0 mira (RPC SECURITY DEFINER
-- chamável fora de uma trigger).
create or replace function public.normalize_knowledge_topic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.topic = lower(btrim(new.topic));
  return new;
end;
$$;

drop trigger if exists knowledge_base_normalize_topic on public.knowledge_base;
create trigger knowledge_base_normalize_topic
  before insert or update on public.knowledge_base
  for each row execute function public.normalize_knowledge_topic();

drop trigger if exists update_knowledge_base_updated_at on public.knowledge_base;
create trigger update_knowledge_base_updated_at
  before update on public.knowledge_base
  for each row execute function public.update_updated_at_column();

-- =============================================================================
-- 5. RPCs do turno (T5, design.md §3.1) — só service_role
-- =============================================================================

-- Claim atômico do inbound pendente: UPDATE...RETURNING é uma única operação no MVCC do
-- Postgres — duas chamadas concorrentes nunca devolvem a mesma linha (AC-A20/D5).
create or replace function public.brain_claim_inbound(p_user uuid, p_conv uuid)
returns setof public.messages
language sql
security definer
set search_path = ''
as $$
  update public.messages
  set processed_at = now()
  where conversation_id = p_conv
    and user_id = p_user
    and direction = 'inbound'
    and processed_at is null
  returning *;
$$;

revoke execute on function public.brain_claim_inbound(uuid, uuid) from public, anon, authenticated;
grant execute on function public.brain_claim_inbound(uuid, uuid) to service_role;

create or replace function public.brain_bump_confirmacoes(p_user uuid, p_conv uuid, p_delta integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  update public.conversations
  set confirmacoes = confirmacoes + p_delta
  where id = p_conv and user_id = p_user
  returning confirmacoes;
$$;

revoke execute on function public.brain_bump_confirmacoes(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.brain_bump_confirmacoes(uuid, uuid, integer) to service_role;

-- optout é monotônico (nunca volta a false por este RPC) e SEMPRE desliga a IA — não só quando
-- p_desligar também vem true (fool r4 B1: dono único da regra "optout desliga IA"). flipped_off/
-- flipped_optout marcam a chamada que efetivamente fez a transição, pra quem chama saber se deve
-- mandar despedida/aviso (não repetir em toda chamada subsequente).
create or replace function public.brain_commit_turn(
  p_user uuid,
  p_conv uuid,
  p_stage text,
  p_qualification_delta jsonb,
  p_summary text,
  p_desligar boolean,
  p_optout boolean,
  p_motivo text
)
returns table (ai_enabled boolean, optout boolean, flipped_off boolean, flipped_optout boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_ai_enabled boolean;
  v_old_optout boolean;
  v_old_ai_stage text;
  v_new_ai_enabled boolean;
  v_new_optout boolean;
  v_new_ai_stage text;
  v_flipped_off boolean;
  v_flipped_optout boolean;
begin
  select c.ai_enabled, c.optout, c.ai_stage
    into v_old_ai_enabled, v_old_optout, v_old_ai_stage
    from public.conversations c
    where c.id = p_conv and c.user_id = p_user
    for update;

  if not found then
    raise exception 'brain_commit_turn: conversa % não encontrada para o usuário %', p_conv, p_user;
  end if;

  v_new_optout := v_old_optout or coalesce(p_optout, false);
  v_new_ai_enabled := v_old_ai_enabled and not (coalesce(p_desligar, false) or coalesce(p_optout, false));
  v_flipped_off := v_old_ai_enabled and not v_new_ai_enabled;
  v_flipped_optout := (not v_old_optout) and v_new_optout;

  v_new_ai_stage := case
    when p_optout then 'descartar'
    when v_old_ai_stage = 'descartar' and v_new_optout and not v_new_ai_enabled then 'descartar'
    else coalesce(p_stage, v_old_ai_stage)
  end;

  update public.conversations c set
    qualification = c.qualification || coalesce(p_qualification_delta, '{}'::jsonb),
    ai_summary = coalesce(p_summary, c.ai_summary),
    optout = v_new_optout,
    optout_motivo = case when v_flipped_optout then p_motivo else c.optout_motivo end,
    ai_enabled = v_new_ai_enabled,
    ai_stage = v_new_ai_stage,
    human_takeover_at = case when v_flipped_off then now() else c.human_takeover_at end
  where c.id = p_conv and c.user_id = p_user;

  return query select v_new_ai_enabled, v_new_optout, v_flipped_off, v_flipped_optout;
end;
$$;

revoke execute on function public.brain_commit_turn(uuid, uuid, text, jsonb, text, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.brain_commit_turn(uuid, uuid, text, jsonb, text, boolean, boolean, text)
  to service_role;

-- Trigger BEFORE ROW comum (mesma exceção de §3.0 aplicada a normalize_knowledge_topic acima):
-- religar a IA manualmente (Conversas.tsx:269) zera confirmacoes e tira a conversa de
-- 'descartar' — sem mexer em optout (AC-A19; decisão do fool B1 registrada em ADR-04/design §3.1:
-- a IA volta a falar com quem deu optout se o humano religou, o prospect ligado não recebe toque).
create or replace function public.conversations_ai_reenable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.ai_enabled = false and new.ai_enabled = true then
    new.confirmacoes = 0;
    if new.ai_stage = 'descartar' then
      new.ai_stage = 'descobrir';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_ai_reenable on public.conversations;
create trigger conversations_ai_reenable
  before update on public.conversations
  for each row execute function public.conversations_ai_reenable();

-- =============================================================================
-- 6. Secret do webhook (T6, ADR-11, design.md §3.1)
-- =============================================================================
create table if not exists private.instance_webhook_secrets (
  instance_id uuid primary key references public.whatsapp_instances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  secret text not null unique default replace(gen_random_uuid()::text, '-', ''),
  secret_prev text,
  prev_until timestamptz,
  confirmed_at timestamptz
);

alter table private.instance_webhook_secrets enable row level security;
revoke all on private.instance_webhook_secrets from anon, authenticated;

-- Cria a linha na hora se não existe (1ª chamada de quem monta a URL do webhook).
create or replace function public.webhook_secret_for(p_user uuid, p_instance uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_secret text;
begin
  select i.user_id into v_owner from public.whatsapp_instances i where i.id = p_instance;
  if v_owner is null or v_owner <> p_user then
    raise exception 'webhook_secret_for: instância % não pertence ao usuário %', p_instance, p_user;
  end if;

  insert into private.instance_webhook_secrets (instance_id, user_id)
  values (p_instance, p_user)
  on conflict (instance_id) do nothing;

  select s.secret into v_secret from private.instance_webhook_secrets s where s.instance_id = p_instance;
  return v_secret;
end;
$$;

revoke execute on function public.webhook_secret_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.webhook_secret_for(uuid, uuid) to service_role;

-- Só gera o candidato e confere posse — NÃO grava nada ainda. Quem chama guarda o valor e só o
-- torna oficial chamando webhook_rotate_commit depois que a Uazapi aceitar a URL nova.
create or replace function public.webhook_rotate_begin(p_user uuid, p_instance uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select i.user_id into v_owner from public.whatsapp_instances i where i.id = p_instance;
  if v_owner is null or v_owner <> p_user then
    raise exception 'webhook_rotate_begin: instância % não pertence ao usuário %', p_instance, p_user;
  end if;
  return replace(gen_random_uuid()::text, '-', '');
end;
$$;

revoke execute on function public.webhook_rotate_begin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.webhook_rotate_begin(uuid, uuid) to service_role;

-- Sem linha existente (webhook_secret_for nunca chamado pra esta instância) ⇒ exception, nada
-- muda — não faz sentido "rotacionar" um secret que nunca existiu (fool r4 W2).
create or replace function public.webhook_rotate_commit(p_user uuid, p_instance uuid, p_novo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select i.user_id into v_owner from public.whatsapp_instances i where i.id = p_instance;
  if v_owner is null or v_owner <> p_user then
    raise exception 'webhook_rotate_commit: instância % não pertence ao usuário %', p_instance, p_user;
  end if;

  update private.instance_webhook_secrets s
  set secret_prev = s.secret,
      prev_until = now() + interval '10 minutes',
      secret = p_novo,
      confirmed_at = null
  where s.instance_id = p_instance;

  if not found then
    raise exception 'webhook_rotate_commit: instância % não tem secret ainda (chame webhook_secret_for antes)', p_instance;
  end if;
end;
$$;

revoke execute on function public.webhook_rotate_commit(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.webhook_rotate_commit(uuid, uuid, text) to service_role;

-- Casa `secret` (atual) ou `secret_prev` (só até `prev_until` — janela de 10min pra Uazapi
-- terminar de aceitar a URL nova sem derrubar mensagens em trânsito).
create or replace function public.webhook_resolve(p_secret text)
returns table (instance_id uuid, user_id uuid, confirmed_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select s.instance_id, s.user_id, s.confirmed_at
  from private.instance_webhook_secrets s
  where s.secret = p_secret
     or (s.secret_prev = p_secret and s.prev_until > now())
  limit 1;
$$;

revoke execute on function public.webhook_resolve(text) from public, anon, authenticated;
grant execute on function public.webhook_resolve(text) to service_role;

create or replace function public.webhook_confirm(p_instance uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.instance_webhook_secrets set confirmed_at = now() where instance_id = p_instance;
$$;

revoke execute on function public.webhook_confirm(uuid) from public, anon, authenticated;
grant execute on function public.webhook_confirm(uuid) to service_role;

create or replace function public.webhook_is_confirmed(p_instance uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.confirmed_at is not null from private.instance_webhook_secrets s where s.instance_id = p_instance),
    false
  );
$$;

revoke execute on function public.webhook_is_confirmed(uuid) from public, anon, authenticated;
grant execute on function public.webhook_is_confirmed(uuid) to service_role;

-- Exceção nomeada do §3.0: o dono vê o próprio secret (a força do `s` já é, na prática, a do
-- token da instância que ele também vê — security r3 W1). A URL é montada fora do banco (o
-- Postgres não conhece a URL do projeto — fool r4 W5).
create or replace function public.my_webhook_secret(p_instance uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select s.secret
  from private.instance_webhook_secrets s
  join public.whatsapp_instances i on i.id = s.instance_id
  where s.instance_id = p_instance
    and i.user_id = auth.uid();
$$;

revoke execute on function public.my_webhook_secret(uuid) from public, anon;
grant execute on function public.my_webhook_secret(uuid) to authenticated;
grant execute on function public.my_webhook_secret(uuid) to service_role;
