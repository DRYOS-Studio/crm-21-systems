create or replace function private.guard_conversation_instance_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.has_role(auth.uid(), 'admin'::public.app_role)
     and old.instance_id is distinct from new.instance_id then
    raise exception 'conversation instance is admin managed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.transfer_conversation(
  p_conversation_id uuid,
  p_to_user uuid,
  p_stage_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_conv public.conversations%rowtype;
  v_target_org uuid;
  v_stage_name text;
  v_new_stage uuid;
  v_target_admin boolean;
begin
  if v_actor is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not private.can_access_conversation(p_conversation_id) then
    raise exception 'conversation_forbidden' using errcode = '42501';
  end if;
  if p_to_user is null then raise exception 'invalid_target' using errcode = '22023'; end if;

  select * into v_conv from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation_not_found'; end if;

  select om.org_id into v_target_org from public.organization_members om
  where om.user_id=p_to_user and om.is_active for update;
  if v_target_org is null or not public.same_org(p_to_user) then
    raise exception 'target_not_in_org_or_inactive' using errcode = '42501';
  end if;
  select exists(select 1 from public.user_roles ur where ur.user_id=p_to_user and ur.role='admin')
    into v_target_admin;
  if not v_target_admin and not exists (
    select 1 from public.organization_member_modules mm
    where mm.org_id=v_target_org and mm.user_id=p_to_user and mm.module_key='crm_conversations'
  ) then raise exception 'target_module_forbidden' using errcode = '42501'; end if;
  if v_conv.instance_id is not null and not v_target_admin and not exists (
    select 1 from public.organization_member_instances mi
    where mi.org_id=v_target_org and mi.user_id=p_to_user and mi.instance_id=v_conv.instance_id
  ) then raise exception 'target_device_forbidden' using errcode = '42501'; end if;
  if v_conv.user_id=p_to_user then
    return jsonb_build_object('ok', true, 'conversation_id', p_conversation_id, 'user_id', p_to_user);
  end if;

  if v_conv.contact_phone is not null and exists (
    select 1 from public.conversations c where c.user_id=p_to_user
      and c.contact_phone=v_conv.contact_phone and c.id<>v_conv.id
  ) then raise exception 'duplicate_contact'; end if;
  if v_conv.contact_email is not null and exists (
    select 1 from public.conversations c where c.user_id=p_to_user
      and c.contact_email=v_conv.contact_email and c.id<>v_conv.id
  ) then raise exception 'duplicate_contact'; end if;

  if p_stage_id is not null then
    select id into v_new_stage from public.pipeline_stages
    where id=p_stage_id and public.same_org(user_id);
    if v_new_stage is null then raise exception 'invalid_stage'; end if;
  elsif v_conv.stage_id is not null then
    select name into v_stage_name from public.pipeline_stages where id=v_conv.stage_id;
    select id into v_new_stage from public.pipeline_stages
    where lower(btrim(name))=lower(btrim(coalesce(v_stage_name,'')))
      and public.same_org(user_id)
    order by (user_id=p_to_user) desc, position asc limit 1;
    if v_new_stage is null then raise exception 'stage_required'; end if;
  end if;

  update public.conversations set user_id=p_to_user, stage_id=v_new_stage, updated_at=now()
  where id=p_conversation_id;
  update public.messages set user_id=p_to_user where conversation_id=p_conversation_id;
  update public.followups set user_id=p_to_user where conversation_id=p_conversation_id;
  update public.prospects set user_id=p_to_user where conversation_id=p_conversation_id;

  return jsonb_build_object('ok',true,'conversation_id',p_conversation_id,
    'user_id',p_to_user,'stage_id',v_new_stage,'instance_id',v_conv.instance_id);
end;
$$;

create or replace function public.transfer_conversation(p_conversation_id uuid, p_to_user uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.transfer_conversation(p_conversation_id,p_to_user,null::uuid);
$$;

revoke all on function public.transfer_conversation(uuid,uuid) from public, anon;
revoke all on function public.transfer_conversation(uuid,uuid,uuid) from public, anon;
grant execute on function public.transfer_conversation(uuid,uuid) to authenticated;
grant execute on function public.transfer_conversation(uuid,uuid,uuid) to authenticated;
