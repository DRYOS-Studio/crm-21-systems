-- Transferir responsável (user_id) de uma conversa para outro membro do time.
-- WhatsApp passa a usar a instância mais recente do destinatário; estágio mapeado por nome.

create or replace function public.transfer_conversation(
  p_conversation_id uuid,
  p_to_user uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_conv public.conversations%rowtype;
  v_stage_name text;
  v_new_stage uuid;
  v_inst uuid;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;
  if p_to_user is null then
    raise exception 'invalid_target';
  end if;
  if not public.same_org(p_to_user) then
    raise exception 'target_not_in_org';
  end if;

  select * into v_conv
  from public.conversations
  where id = p_conversation_id
  for update;

  if not found then
    raise exception 'conversation_not_found';
  end if;
  if not public.same_org(v_conv.user_id) then
    raise exception 'forbidden';
  end if;
  if v_conv.user_id = p_to_user then
    return jsonb_build_object('ok', true, 'conversation_id', p_conversation_id, 'user_id', p_to_user);
  end if;

  if v_conv.contact_phone is not null then
    if exists (
      select 1 from public.conversations
      where user_id = p_to_user
        and contact_phone = v_conv.contact_phone
        and id <> v_conv.id
    ) then
      raise exception 'duplicate_contact';
    end if;
  end if;

  if v_conv.contact_email is not null then
    if exists (
      select 1 from public.conversations
      where user_id = p_to_user
        and contact_email = v_conv.contact_email
        and id <> v_conv.id
    ) then
      raise exception 'duplicate_contact';
    end if;
  end if;

  v_new_stage := null;
  if v_conv.stage_id is not null then
    select name into v_stage_name from public.pipeline_stages where id = v_conv.stage_id;
    select id into v_new_stage
    from public.pipeline_stages
    where user_id = p_to_user
      and lower(btrim(name)) = lower(btrim(coalesce(v_stage_name, '')))
    limit 1;
    if v_new_stage is null then
      select id into v_new_stage
      from public.pipeline_stages
      where user_id = p_to_user
      order by position asc
      limit 1;
    end if;
  end if;

  select id into v_inst
  from public.whatsapp_instances
  where user_id = p_to_user
  order by updated_at desc nulls last
  limit 1;

  update public.conversations
  set
    user_id = p_to_user,
    stage_id = coalesce(v_new_stage, stage_id),
    instance_id = coalesce(v_inst, instance_id),
    updated_at = now()
  where id = p_conversation_id;

  update public.messages set user_id = p_to_user where conversation_id = p_conversation_id;
  update public.followups set user_id = p_to_user where conversation_id = p_conversation_id;
  update public.prospects set user_id = p_to_user where conversation_id = p_conversation_id;

  return jsonb_build_object(
    'ok', true,
    'conversation_id', p_conversation_id,
    'user_id', p_to_user,
    'stage_id', coalesce(v_new_stage, v_conv.stage_id),
    'instance_id', coalesce(v_inst, v_conv.instance_id)
  );
end;
$$;

revoke all on function public.transfer_conversation(uuid, uuid) from public, anon;
grant execute on function public.transfer_conversation(uuid, uuid) to authenticated;
