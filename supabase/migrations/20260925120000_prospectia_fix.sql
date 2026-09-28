-- ProspectIA: empresa no Kanban + disparo usa a instância WhatsApp do Q7.

alter table public.conversations
  add column if not exists contact_company text;
alter table public.conversations
  add column if not exists contact_city text;

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
  v_instance uuid;
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

  select id into v_instance
  from public.whatsapp_instances
  where user_id = p_user
    and instance_token is not null
  order by updated_at desc
  limit 1;
  if v_instance is null then
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
        set instance_id = coalesce(instance_id, v_instance),
            stage_id = coalesce(stage_id, v_stage),
            contact_name = coalesce(contact_name, v_prospect.name),
            contact_company = coalesce(contact_company, v_prospect.company),
            contact_city = coalesce(contact_city, v_prospect.city)
        where id = v_conv.id and user_id = p_user
        returning * into v_conv;
      else
        insert into public.conversations (
          user_id, contact_phone, wa_phone, contact_name, contact_company, contact_city,
          ai_stage, ai_enabled, instance_id, stage_id
        ) values (
          p_user, v_prospect.phone, v_prospect.phone, v_prospect.name, v_prospect.company, v_prospect.city,
          'abordar', true, v_instance, v_stage
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
