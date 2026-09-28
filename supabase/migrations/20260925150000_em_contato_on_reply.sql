-- Primeira resposta do lead → card vai para a coluna "Em contato".

create or replace function public.seed_pipeline_stages(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.pipeline_stages where user_id = _user_id) then
    insert into public.pipeline_stages (user_id, name, position, color) values
      (_user_id, 'Novo Lead',  0, '#3FB8BE'),
      (_user_id, 'Em contato', 1, '#F59E0B'),
      (_user_id, 'Fechado',    2, '#10B981');
  end if;
end;
$$;

update public.pipeline_stages s
set name = 'Em contato'
where lower(btrim(s.name)) = 'em negociação'
  and not exists (
    select 1 from public.pipeline_stages x
    where x.user_id = s.user_id
      and lower(btrim(x.name)) = 'em contato'
  );

insert into public.pipeline_stages (user_id, name, position, color)
select u.id, 'Em contato', 1, '#F59E0B'
from auth.users u
where not exists (
  select 1 from public.pipeline_stages x
  where x.user_id = u.id
    and lower(btrim(x.name)) = 'em contato'
)
  and exists (
    select 1 from public.pipeline_stages x where x.user_id = u.id
  );

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

  select id into v_stage
  from public.pipeline_stages
  where user_id = v_user
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
  where id = new.conversation_id
    and user_id = v_user;

  return new;
end;
$$;

drop trigger if exists conversation_on_first_inbound on public.messages;
create trigger conversation_on_first_inbound
  after insert on public.messages
  for each row execute function public.conversation_on_first_inbound();
