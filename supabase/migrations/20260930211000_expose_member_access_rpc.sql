create or replace function public.admin_save_member_access(
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
begin
  perform private.admin_save_member_access(
    p_actor,
    p_target,
    p_is_active,
    p_module_keys,
    p_instance_ids
  );
end;
$$;

revoke all on function public.admin_save_member_access(uuid, uuid, boolean, text[], uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_save_member_access(uuid, uuid, boolean, text[], uuid[])
  to service_role;

notify pgrst, 'reload schema';
