-- Keep membership status authoritative across profile, role and organization reads.
create or replace function public.my_org_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select om.org_id from public.organization_members om
  where om.user_id = auth.uid() and om.is_active limit 1;
$$;
revoke all on function public.my_org_id() from public, anon;
grant execute on function public.my_org_id() to authenticated, service_role;

do $$
declare t text; p record;
begin
  foreach t in array array['profiles','user_roles','organization_members','organizations','q7_local_access'] loop
    if to_regclass(format('public.%I', t)) is not null then
      for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
        execute format('drop policy %I on public.%I', p.policyname, t);
      end loop;
    end if;
  end loop;
end $$;

create policy active_member_profiles_read on public.profiles for select to authenticated
  using (
    private.member_is_active(auth.uid())
    and (auth.uid() = user_id or private.has_role(auth.uid(), 'admin'::public.app_role)
      or public.same_org(user_id))
  );
create policy active_member_profiles_insert on public.profiles for insert to authenticated
  with check (auth.uid() = user_id and private.member_is_active(auth.uid()));
create policy active_member_profiles_update on public.profiles for update to authenticated
  using (private.member_is_active(auth.uid())
    and (auth.uid() = user_id or private.has_role(auth.uid(), 'admin'::public.app_role)))
  with check (private.member_is_active(auth.uid())
    and (auth.uid() = user_id or private.has_role(auth.uid(), 'admin'::public.app_role)));

create policy active_member_roles_read on public.user_roles for select to authenticated
  using (private.member_is_active(auth.uid())
    and (auth.uid() = user_id or private.has_role(auth.uid(), 'admin'::public.app_role)));
create policy active_admin_roles_insert on public.user_roles for insert to authenticated
  with check (private.member_is_active(auth.uid()) and private.has_role(auth.uid(), 'admin'::public.app_role));
create policy active_admin_roles_update on public.user_roles for update to authenticated
  using (private.member_is_active(auth.uid()) and private.has_role(auth.uid(), 'admin'::public.app_role))
  with check (private.member_is_active(auth.uid()) and private.has_role(auth.uid(), 'admin'::public.app_role));
create policy active_admin_roles_delete on public.user_roles for delete to authenticated
  using (private.member_is_active(auth.uid()) and private.has_role(auth.uid(), 'admin'::public.app_role));

create policy active_org_members_read on public.organization_members for select to authenticated
  using (private.member_is_active(auth.uid()) and org_id = public.my_org_id());
create policy active_org_read on public.organizations for select to authenticated
  using (private.member_is_active(auth.uid()) and id = public.my_org_id());
create policy active_admin_org_logo_update on public.organizations for update to authenticated
  using (private.member_is_active(auth.uid()) and id = public.my_org_id()
    and private.has_role(auth.uid(), 'admin'::public.app_role))
  with check (private.member_is_active(auth.uid()) and id = public.my_org_id()
    and private.has_role(auth.uid(), 'admin'::public.app_role));

create policy active_admin_settings_read on public.app_settings for select to authenticated
  using (private.member_is_active(auth.uid()) and private.has_role(auth.uid(), 'admin'::public.app_role));
create policy active_admin_settings_insert on public.app_settings for insert to authenticated
  with check (private.member_is_active(auth.uid()) and private.has_role(auth.uid(), 'admin'::public.app_role));
create policy active_admin_settings_update on public.app_settings for update to authenticated
  using (private.member_is_active(auth.uid()) and private.has_role(auth.uid(), 'admin'::public.app_role))
  with check (private.member_is_active(auth.uid()) and private.has_role(auth.uid(), 'admin'::public.app_role));
create policy active_admin_settings_delete on public.app_settings for delete to authenticated
  using (private.member_is_active(auth.uid()) and private.has_role(auth.uid(), 'admin'::public.app_role));

create policy active_member_local_access_read on public.q7_local_access for select to authenticated
  using (private.member_is_active(auth.uid()));

drop policy if exists org_admin_upload_brand_logo on storage.objects;
drop policy if exists org_admin_replace_brand_logo on storage.objects;
create policy org_admin_upload_brand_logo on storage.objects for insert to authenticated
  with check (bucket_id = 'organization-brand'
    and (storage.foldername(name))[1] = (public.my_org_id())::text
    and private.member_is_active(auth.uid())
    and private.has_role(auth.uid(), 'admin'::public.app_role));
create policy org_admin_replace_brand_logo on storage.objects for update to authenticated
  using (bucket_id = 'organization-brand'
    and (storage.foldername(name))[1] = (public.my_org_id())::text
    and private.member_is_active(auth.uid())
    and private.has_role(auth.uid(), 'admin'::public.app_role))
  with check (bucket_id = 'organization-brand'
    and (storage.foldername(name))[1] = (public.my_org_id())::text
    and private.member_is_active(auth.uid())
    and private.has_role(auth.uid(), 'admin'::public.app_role));
