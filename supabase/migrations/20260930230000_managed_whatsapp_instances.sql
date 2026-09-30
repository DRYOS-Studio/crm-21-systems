alter table public.whatsapp_instances
  add column if not exists is_organization_shared boolean not null default false;

drop policy if exists "Admins can view app_settings" on public.app_settings;
drop policy if exists "Admins can insert app_settings" on public.app_settings;
drop policy if exists "Admins can update app_settings" on public.app_settings;
drop policy if exists "Admins can delete app_settings" on public.app_settings;
drop policy if exists active_admin_settings_read on public.app_settings;
drop policy if exists active_admin_settings_insert on public.app_settings;
drop policy if exists active_admin_settings_update on public.app_settings;
drop policy if exists active_admin_settings_delete on public.app_settings;

create policy active_admin_settings_read on public.app_settings for select to authenticated
  using (private.member_is_active(auth.uid())
    and private.has_role(auth.uid(), 'admin'::public.app_role)
    and key not in ('uazapi_server_url', 'uazapi_admin_token', 'uazapi_instance_token'));
create policy active_admin_settings_insert on public.app_settings for insert to authenticated
  with check (private.member_is_active(auth.uid())
    and private.has_role(auth.uid(), 'admin'::public.app_role)
    and key not in ('uazapi_server_url', 'uazapi_admin_token', 'uazapi_instance_token'));
create policy active_admin_settings_update on public.app_settings for update to authenticated
  using (private.member_is_active(auth.uid())
    and private.has_role(auth.uid(), 'admin'::public.app_role)
    and key not in ('uazapi_server_url', 'uazapi_admin_token', 'uazapi_instance_token'))
  with check (private.member_is_active(auth.uid())
    and private.has_role(auth.uid(), 'admin'::public.app_role)
    and key not in ('uazapi_server_url', 'uazapi_admin_token', 'uazapi_instance_token'));
create policy active_admin_settings_delete on public.app_settings for delete to authenticated
  using (private.member_is_active(auth.uid())
    and private.has_role(auth.uid(), 'admin'::public.app_role)
    and key not in ('uazapi_server_url', 'uazapi_admin_token', 'uazapi_instance_token'));

create or replace function private.grant_shared_instances_to_active_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active then
    insert into public.organization_member_instances (org_id, user_id, instance_id)
    select new.org_id, new.user_id, wi.id
    from public.organization_members owner
    join public.whatsapp_instances wi on wi.user_id = owner.user_id
    where owner.org_id = new.org_id and owner.is_active and wi.is_organization_shared
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists grant_shared_instances_to_active_member on public.organization_members;
create trigger grant_shared_instances_to_active_member
  after insert or update of is_active on public.organization_members
  for each row execute function private.grant_shared_instances_to_active_member();

create or replace function private.grant_shared_instance_to_org_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_organization_shared then
    insert into public.organization_member_instances (org_id, user_id, instance_id)
    select member.org_id, member.user_id, new.id
    from public.organization_members member
    where member.user_id = new.user_id and member.is_active
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists grant_shared_instance_to_org_members on public.whatsapp_instances;
create trigger grant_shared_instance_to_org_members
  after insert or update of is_organization_shared, user_id on public.whatsapp_instances
  for each row execute function private.grant_shared_instance_to_org_members();

insert into public.organization_member_instances (org_id, user_id, instance_id)
select member.org_id, member.user_id, wi.id
from public.organization_members member
join public.organization_members owner on owner.org_id = member.org_id and owner.is_active
join public.whatsapp_instances wi on wi.user_id = owner.user_id
where member.is_active and wi.is_organization_shared
on conflict do nothing;

revoke all on function private.grant_shared_instances_to_active_member() from public, anon, authenticated;
grant execute on function private.grant_shared_instances_to_active_member() to service_role;
revoke all on function private.grant_shared_instance_to_org_members() from public, anon, authenticated;
grant execute on function private.grant_shared_instance_to_org_members() to service_role;
