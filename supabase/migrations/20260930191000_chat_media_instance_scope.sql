create or replace function private.member_has_instance_path(_user_id uuid, _path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare path_instance uuid;
begin
  if split_part(_path, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  path_instance := split_part(_path, '/', 1)::uuid;
  return private.member_has_instance(_user_id, path_instance);
end;
$$;
revoke all on function private.member_has_instance_path(uuid, text) from public, anon;
grant execute on function private.member_has_instance_path(uuid, text) to authenticated, service_role;

drop policy if exists member_upload_chat_media on storage.objects;
drop policy if exists member_read_chat_media on storage.objects;
create policy member_upload_chat_media on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media'
    and private.member_has_module(auth.uid(), 'crm_conversations')
    and private.member_has_instance_path(auth.uid(), name));
create policy member_read_chat_media on storage.objects for select to authenticated
  using (bucket_id = 'chat-media'
    and private.member_has_module(auth.uid(), 'crm_conversations')
    and private.member_has_instance_path(auth.uid(), name));
