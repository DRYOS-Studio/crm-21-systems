create or replace function public.my_member_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_active', om.is_active,
    'is_admin', private.has_role(auth.uid(), 'admin'::public.app_role),
    'access_review_required', om.access_review_required,
    'module_keys', coalesce((
      select jsonb_agg(mm.module_key order by mm.module_key)
      from public.organization_member_modules mm
      where mm.org_id=om.org_id and mm.user_id=om.user_id
    ), '[]'::jsonb),
    'instance_ids', coalesce((
      select jsonb_agg(mi.instance_id order by mi.instance_id)
      from public.organization_member_instances mi
      where mi.org_id=om.org_id and mi.user_id=om.user_id
    ), '[]'::jsonb)
  )
  from public.organization_members om
  where om.user_id=auth.uid()
  limit 1;
$$;
revoke all on function public.my_member_access() from public, anon;
grant execute on function public.my_member_access() to authenticated;
grant execute on function public.my_member_access() to service_role;

revoke execute on function public.my_webhook_secret(uuid) from public, anon, authenticated;
grant execute on function public.my_webhook_secret(uuid) to service_role;
revoke execute on function public.org_user_ids(uuid) from public, anon, authenticated;
grant execute on function public.org_user_ids(uuid) to service_role;
