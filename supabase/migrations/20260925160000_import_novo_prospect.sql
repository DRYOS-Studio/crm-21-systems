-- Importados (CSV/prospects) viram card na coluna Novo Prospect.

create or replace function public.stage_novo_prospect(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user is null then
    return null;
  end if;

  select id into v_id
  from public.pipeline_stages
  where user_id = p_user
    and lower(btrim(name)) in ('novo prospect', 'novo lead')
  order by case when lower(btrim(name)) = 'novo prospect' then 0 else 1 end, position
  limit 1;

  if v_id is null then
    insert into public.pipeline_stages (user_id, name, position, color)
    values (p_user, 'Novo Prospect', 0, '#3FB8BE')
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.stage_novo_prospect(uuid) from public, anon, authenticated;
grant execute on function public.stage_novo_prospect(uuid) to service_role;

create or replace function public.place_prospect_novo_prospect(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.prospects;
  v_stage uuid;
  v_conv public.conversations;
begin
  select * into v_p from public.prospects where id = p_id;
  if not found then
    return;
  end if;

  v_stage := public.stage_novo_prospect(v_p.user_id);
  if v_stage is null then
    return;
  end if;

  if v_p.conversation_id is not null then
    select * into v_conv
    from public.conversations
    where id = v_p.conversation_id and user_id = v_p.user_id;
  else
    select * into v_conv
    from public.conversations
    where user_id = v_p.user_id
      and contact_phone = v_p.phone;
  end if;

  if v_conv.id is not null then
    if exists (
      select 1 from public.messages m
      where m.conversation_id = v_conv.id
        and m.direction = 'inbound'
    ) then
      if v_p.conversation_id is null then
        update public.prospects
        set conversation_id = v_conv.id
        where id = v_p.id;
      end if;
      return;
    end if;

    update public.conversations
    set stage_id = v_stage,
        contact_name = coalesce(contact_name, v_p.name),
        contact_company = coalesce(contact_company, v_p.company),
        contact_city = coalesce(contact_city, v_p.city),
        wa_phone = coalesce(wa_phone, v_p.phone)
    where id = v_conv.id
      and user_id = v_p.user_id;

    update public.prospects
    set conversation_id = v_conv.id
    where id = v_p.id and conversation_id is distinct from v_conv.id;
    return;
  end if;

  insert into public.conversations (
    user_id, contact_phone, wa_phone, contact_name, contact_company, contact_city,
    ai_stage, ai_enabled, stage_id
  ) values (
    v_p.user_id, v_p.phone, v_p.phone, v_p.name, v_p.company, v_p.city,
    'abordar', true, v_stage
  )
  returning * into v_conv;

  update public.prospects
  set conversation_id = v_conv.id
  where id = v_p.id;
exception
  when unique_violation then
    select * into v_conv
    from public.conversations
    where user_id = v_p.user_id
      and contact_phone = v_p.phone;
    if v_conv.id is not null then
      update public.prospects
      set conversation_id = v_conv.id
      where id = v_p.id and conversation_id is distinct from v_conv.id;
    end if;
end;
$$;

revoke all on function public.place_prospect_novo_prospect(uuid) from public, anon, authenticated;
grant execute on function public.place_prospect_novo_prospect(uuid) to service_role;

create or replace function public.prospects_on_insert_novo_prospect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.place_prospect_novo_prospect(new.id);
  return new;
end;
$$;

drop trigger if exists prospects_on_insert_novo_prospect on public.prospects;
create trigger prospects_on_insert_novo_prospect
  after insert on public.prospects
  for each row execute function public.prospects_on_insert_novo_prospect();

create or replace function public.seed_pipeline_stages(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.pipeline_stages where user_id = _user_id) then
    insert into public.pipeline_stages (user_id, name, position, color) values
      (_user_id, 'Novo Prospect', 0, '#3FB8BE'),
      (_user_id, 'Em contato',    1, '#F59E0B'),
      (_user_id, 'Fechado',       2, '#10B981');
  end if;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select id from public.prospects
    where estado = 'fila'
      and tentativas = 0
      and optout = false
  loop
    perform public.place_prospect_novo_prospect(r.id);
  end loop;
end;
$$;
