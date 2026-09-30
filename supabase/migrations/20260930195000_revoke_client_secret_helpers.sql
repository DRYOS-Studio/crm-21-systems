revoke execute on function public.my_webhook_secret(uuid) from public, anon, authenticated;
grant execute on function public.my_webhook_secret(uuid) to service_role;

revoke execute on function public.org_user_ids(uuid) from public, anon, authenticated;
grant execute on function public.org_user_ids(uuid) to service_role;
