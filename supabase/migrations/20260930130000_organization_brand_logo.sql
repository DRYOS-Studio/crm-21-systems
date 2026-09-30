alter table public.organizations add column if not exists logo_url text;
grant update (logo_url) on public.organizations to authenticated;

drop policy if exists org_admin_update_logo on public.organizations;
create policy org_admin_update_logo on public.organizations
  for update to authenticated
  using (id = public.my_org_id() and public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (id = public.my_org_id() and public.has_role(auth.uid(), 'admin'::public.app_role));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organization-brand', 'organization-brand', true, 2097152, array['image/png'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists org_admin_upload_brand_logo on storage.objects;
create policy org_admin_upload_brand_logo on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'organization-brand'
    and (storage.foldername(name))[1] = public.my_org_id()::text
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );

drop policy if exists org_admin_replace_brand_logo on storage.objects;
create policy org_admin_replace_brand_logo on storage.objects
  for update to authenticated
  using (
    bucket_id = 'organization-brand'
    and (storage.foldername(name))[1] = public.my_org_id()::text
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  with check (
    bucket_id = 'organization-brand'
    and (storage.foldername(name))[1] = public.my_org_id()::text
    and public.has_role(auth.uid(), 'admin'::public.app_role)
  );
