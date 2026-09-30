create or replace function private.admin_save_member_access(
  p_actor uuid,
  p_target uuid,
  p_is_active boolean,
  p_module_keys text[],
  p_instance_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_org uuid;
  target_org uuid;
  target_is_admin boolean;
  active_admins integer;
  requested_modules text[];
  invalid_devices integer;
begin
  select om.org_id into actor_org from public.organization_members om
  where om.user_id = p_actor and om.is_active;
  if actor_org is null or not private.has_role(p_actor, 'admin'::public.app_role) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if p_actor = p_target and not p_is_active then
    raise exception 'cannot deactivate self' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_org::text, 0));
  select om.org_id into target_org from public.organization_members om
  where om.user_id = p_target for update;
  if target_org is distinct from actor_org then
    raise exception 'member is outside organization' using errcode = '42501';
  end if;

  select exists (select 1 from public.user_roles ur where ur.user_id=p_target and ur.role='admin')
  into target_is_admin;
  if target_is_admin and not p_is_active then
    select count(*) into active_admins
    from public.organization_members om
    join public.user_roles ur on ur.user_id=om.user_id and ur.role='admin'
    where om.org_id=actor_org and om.is_active;
    if active_admins <= 1 then
      raise exception 'cannot deactivate last admin' using errcode = '23514';
    end if;
  end if;

  requested_modules := array(
    select distinct case when input.module_key in ('crm', 'conversations', 'crm_conversations', 'agenda', 'dashboard')
      then 'crm_conversations' else input.module_key end
    from unnest(coalesce(p_module_keys, array[]::text[])) as input(module_key)
  );
  if exists (select 1 from unnest(requested_modules) as requested(module_key)
    where requested.module_key not in ('crm_conversations','prospecting','settings')) then
    raise exception 'invalid module grant' using errcode = '22023';
  end if;

  select count(*) into invalid_devices
  from (select distinct unnest(coalesce(p_instance_ids, array[]::uuid[])) id) requested
  where not exists (
    select 1 from public.whatsapp_instances wi
    join public.organization_members owner on owner.user_id=wi.user_id and owner.org_id=actor_org
    where wi.id=requested.id
  );
  if invalid_devices > 0 then
    raise exception 'device is outside organization' using errcode = '22023';
  end if;

  update public.organization_members set is_active=p_is_active, access_review_required=false
  where org_id=actor_org and user_id=p_target;

  delete from public.organization_member_modules where org_id=actor_org and user_id=p_target;
  insert into public.organization_member_modules(org_id,user_id,module_key)
  select actor_org,p_target,modules.module_key from unnest(requested_modules) as modules(module_key);

  delete from public.organization_member_instances where org_id=actor_org and user_id=p_target;
  insert into public.organization_member_instances(org_id,user_id,instance_id)
  select actor_org,p_target,instance_id
  from (select distinct unnest(coalesce(p_instance_ids,array[]::uuid[])) instance_id) requested;
end;
$$;

revoke all on function private.admin_save_member_access(uuid,uuid,boolean,text[],uuid[]) from public, anon, authenticated;
grant execute on function private.admin_save_member_access(uuid,uuid,boolean,text[],uuid[]) to service_role;
