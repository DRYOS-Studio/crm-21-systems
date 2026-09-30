-- Prevent authenticated callers from probing grants for arbitrary user IDs.
create or replace function private.member_is_active(_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() = _user_id and exists (
    select 1 from public.organization_members om
    where om.user_id = _user_id and om.is_active
  );
$$;

create or replace function private.member_has_module(_user_id uuid, _module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() = _user_id and private.member_is_active(_user_id) and (
    private.has_role(_user_id, 'admin'::public.app_role)
    or exists (
      select 1 from public.organization_member_modules mm
      join public.organization_members om using (org_id, user_id)
      where mm.user_id = _user_id and om.is_active
        and mm.module_key = case when _module in ('crm', 'conversations', 'agenda', 'dashboard')
          then 'crm_conversations' else _module end
    )
  );
$$;

create or replace function private.member_has_instance(_user_id uuid, _instance_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() = _user_id and private.member_is_active(_user_id) and exists (
    select 1 from public.whatsapp_instances wi
    join public.organization_members owner on owner.user_id = wi.user_id
    join public.organization_members member on member.org_id = owner.org_id and member.user_id = _user_id
    where wi.id = _instance_id and member.is_active
      and (private.has_role(_user_id, 'admin'::public.app_role) or exists (
        select 1 from public.organization_member_instances mi
        where mi.org_id = member.org_id and mi.user_id = _user_id and mi.instance_id = wi.id
      ))
  );
$$;
