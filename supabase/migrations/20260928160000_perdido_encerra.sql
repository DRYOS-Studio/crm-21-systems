-- Perdido no Kanban = atendimento encerrado no inbox (IA off, sem follow-up).

create or replace function public.eh_stage_perdido(p_name text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_name, ''))) ~ 'perdid';
$$;

revoke all on function public.eh_stage_perdido(text) from public, anon;
grant execute on function public.eh_stage_perdido(text) to authenticated, service_role;

create or replace function public.conversation_before_stage_perdido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.stage_id is null or new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  select name into v_name from public.pipeline_stages where id = new.stage_id;
  if public.eh_stage_perdido(v_name) then
    new.ai_enabled := false;
    new.human_takeover_at := coalesce(new.human_takeover_at, now());
    new.inactivity_followup_at := null;
    new.auto_followup_count := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_before_stage_perdido on public.conversations;
create trigger conversation_before_stage_perdido
  before update of stage_id on public.conversations
  for each row execute function public.conversation_before_stage_perdido();

create or replace function public.conversation_after_stage_perdido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.stage_id is null or new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  select name into v_name from public.pipeline_stages where id = new.stage_id;
  if public.eh_stage_perdido(v_name) then
    update public.followups
    set status = 'cancelled'
    where conversation_id = new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_after_stage_perdido on public.conversations;
create trigger conversation_after_stage_perdido
  after update of stage_id on public.conversations
  for each row execute function public.conversation_after_stage_perdido();

-- Primeira resposta não reabre quem já está em Perdido.
create or replace function public.conversation_on_first_inbound()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_stage uuid;
  v_prev int;
  v_curr text;
begin
  if new.direction is distinct from 'inbound' then
    return new;
  end if;

  select count(*) into v_prev
  from public.messages
  where conversation_id = new.conversation_id
    and direction = 'inbound'
    and id is distinct from new.id;
  if v_prev > 0 then
    return new;
  end if;

  v_user := new.user_id;
  if v_user is null then
    select user_id into v_user
    from public.conversations
    where id = new.conversation_id;
  end if;
  if v_user is null then
    return new;
  end if;

  select s.name into v_curr
  from public.conversations c
  join public.pipeline_stages s on s.id = c.stage_id
  where c.id = new.conversation_id;
  if public.eh_stage_perdido(v_curr) then
    return new;
  end if;

  select id into v_stage
  from public.pipeline_stages
  where user_id in (select public.org_user_ids(v_user))
    and lower(btrim(name)) = 'em contato'
  order by position
  limit 1;

  if v_stage is null then
    insert into public.pipeline_stages (user_id, name, position, color)
    values (v_user, 'Em contato', 1, '#F59E0B')
    returning id into v_stage;
  end if;

  update public.conversations
  set stage_id = v_stage
  where id = new.conversation_id;

  return new;
end;
$$;

update public.conversations c
set
  ai_enabled = false,
  human_takeover_at = coalesce(c.human_takeover_at, now()),
  inactivity_followup_at = null,
  auto_followup_count = 0
from public.pipeline_stages s
where c.stage_id = s.id
  and public.eh_stage_perdido(s.name)
  and (c.ai_enabled = true or c.inactivity_followup_at is not null);

update public.followups f
set status = 'cancelled'
from public.conversations c
join public.pipeline_stages s on s.id = c.stage_id
where f.conversation_id = c.id
  and f.status = 'pending'
  and public.eh_stage_perdido(s.name);
