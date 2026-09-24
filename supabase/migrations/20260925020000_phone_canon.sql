-- Canonicalização de telefone (T7, design.md §3.2, AC-C3/C3b) — chave estável pra comparar
-- telefones vindos em formatos diferentes (WhatsApp, CSV, digitação humana, Extrator).

-- =============================================================================
-- 1. canon_phone — número que JÁ tem DDI (uso interno: triggers, comparação). Idempotente:
--    aplicar 2x no mesmo valor dá o mesmo resultado — é o único que pode entrar em trigger.
-- =============================================================================
create or replace function public.canon_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null or length(regexp_replace(p_phone, '\D', '', 'g')) = 0 then null
    when length(regexp_replace(p_phone, '\D', '', 'g')) = 12
      and left(regexp_replace(p_phone, '\D', '', 'g'), 2) = '55'
      and substring(regexp_replace(p_phone, '\D', '', 'g') from 5 for 1) between '6' and '9'
    then
      left(regexp_replace(p_phone, '\D', '', 'g'), 4)
      || '9'
      || substring(regexp_replace(p_phone, '\D', '', 'g') from 5)
    else regexp_replace(p_phone, '\D', '', 'g')
  end;
$$;

-- =============================================================================
-- 2. canon_phone_input — número digitado por humano (CSV, formulário). NÃO é idempotente pra
--    número estrangeiro de 11 dígitos (perde o '+' na 1ª passada, e a 2ª passada o confundiria
--    com BR sem DDI) — por isso nunca entra em trigger, só em UI/import.
-- =============================================================================
create or replace function public.canon_phone_input(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null then null
    when p_phone like '%+%' then public.canon_phone(regexp_replace(p_phone, '\D', '', 'g'))
    when length(regexp_replace(p_phone, '\D', '', 'g')) in (10, 11)
      then public.canon_phone('55' || regexp_replace(p_phone, '\D', '', 'g'))
    when length(regexp_replace(p_phone, '\D', '', 'g')) between 12 and 15
      then public.canon_phone(regexp_replace(p_phone, '\D', '', 'g'))
    else null
  end;
$$;

revoke execute on function public.canon_phone_input(text) from public, anon;
grant execute on function public.canon_phone_input(text) to authenticated, service_role;

create or replace function public.canon_phone_input_batch(p_phones text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if array_length(p_phones, 1) > 5000 then
    raise exception 'canon_phone_input_batch: lote de % telefones excede o limite de 5000', array_length(p_phones, 1);
  end if;
  return array(select public.canon_phone_input(p) from unnest(p_phones) as p);
end;
$$;

revoke execute on function public.canon_phone_input_batch(text[]) from public, anon;
grant execute on function public.canon_phone_input_batch(text[]) to authenticated, service_role;

-- =============================================================================
-- 3. Triggers (só canon_phone — nunca canon_phone_input, ver acima)
-- =============================================================================
create or replace function public.conversations_canon_contact_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.contact_phone = public.canon_phone(new.contact_phone);
  return new;
end;
$$;

-- `UPDATE OF contact_phone`, não `UPDATE` puro: um update em QUALQUER outra coluna (ex.: o
-- próprio passo 1 do backfill abaixo, que só toca wa_phone) não pode reprocessar contact_phone —
-- senão uma linha antiga e suja que colidiria só é pega na hora errada (achado desta task: o
-- passo 1 do backfill batia direto no índice único antes do passo 2 ter chance de checar).
drop trigger if exists conversations_canon_contact_phone on public.conversations;
create trigger conversations_canon_contact_phone
  before insert or update of contact_phone on public.conversations
  for each row execute function public.conversations_canon_contact_phone();

create or replace function public.agent_configs_canon_owner_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.owner_notify_phone = public.canon_phone(new.owner_notify_phone);
  return new;
end;
$$;

drop trigger if exists agent_configs_canon_owner_phone on public.agent_configs;
create trigger agent_configs_canon_owner_phone
  before insert or update of owner_notify_phone on public.agent_configs
  for each row execute function public.agent_configs_canon_owner_phone();

-- prospects.phone entra em T26 (a tabela só existe a partir de 20260925030000_outreach.sql).

-- =============================================================================
-- 4. wa_phone — dígitos crus do último JID visto (nunca canonicalizado; é o que o WhatsApp
--    realmente aceita no envio). coalesce(wa_phone, contact_phone) é o padrão de envio — fica
--    pra T14/T16/T23/T29, aqui só a coluna.
-- =============================================================================
alter table public.conversations add column if not exists wa_phone text;

-- =============================================================================
-- 5. Backfill fail-closed (marcador phone_canon.backfill) — tudo num único DO: uma exception
--    em qualquer ponto desfaz o bloco inteiro (nem o passo 1 fica gravado), "sem mesclar".
-- =============================================================================
do $$
declare
  v_collisions int;
  v_would_violate int;
begin
  if not exists (select 1 from private.q7_markers where key = 'phone_canon.backfill') then

    -- (1) preserva o dígito cru mais recente que já tínhamos, só onde ainda não existe.
    update public.conversations set wa_phone = contact_phone where wa_phone is null;

    -- (2) colisão: duas linhas do mesmo tenant que canonicalizam pro mesmo telefone (chave nula
    -- excluída — não é colisão, é "sem telefone"). Conta também quem ficaria sem NENHUM
    -- identificador (canon dá null e não tem contact_email) — violaria
    -- conversations_contact_identifier_chk se a gente escrevesse.
    select count(*) into v_collisions from (
      select user_id, public.canon_phone(contact_phone) as canon
      from public.conversations
      where contact_phone is not null and public.canon_phone(contact_phone) is not null
      group by user_id, public.canon_phone(contact_phone)
      having count(*) > 1
    ) dup;

    select count(*) into v_would_violate
    from public.conversations
    where contact_phone is not null
      and public.canon_phone(contact_phone) is null
      and contact_email is null;

    if v_collisions > 0 or v_would_violate > 0 then
      raise exception 'phone_canon backfill abortado: % grupo(s) colidindo após canonicalizar, % linha(s) ficariam sem identificador — nada foi escrito (rode a query de diagnóstico e resolva as duplicatas manualmente antes de reaplicar esta migration)',
        v_collisions, v_would_violate;
    end if;

    -- (3) sem colisão: canonicaliza de verdade.
    update public.conversations
    set contact_phone = public.canon_phone(contact_phone)
    where contact_phone is not null;

    insert into private.q7_markers (key) values ('phone_canon.backfill');
  end if;
end $$;
