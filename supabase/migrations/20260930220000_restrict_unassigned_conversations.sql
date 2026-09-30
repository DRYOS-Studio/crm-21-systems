create or replace function private.can_access_conversation(_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    where c.id = _conversation_id
      and public.same_org(c.user_id)
      and private.member_has_module(auth.uid(), 'crm_conversations')
      and (
        private.has_role(auth.uid(), 'admin'::public.app_role)
        or (c.instance_id is null and c.user_id = auth.uid())
        or (c.instance_id is not null and private.member_has_instance(auth.uid(), c.instance_id))
      )
  );
$$;

drop policy if exists member_conversations on public.conversations;
create policy member_conversations on public.conversations for all to authenticated
  using (private.can_access_conversation(id))
  with check (
    public.same_org(user_id)
    and private.member_has_module(auth.uid(), 'crm_conversations')
    and (
      private.has_role(auth.uid(), 'admin'::public.app_role)
      or (instance_id is null and user_id = auth.uid())
      or (instance_id is not null and private.member_has_instance(auth.uid(), instance_id))
    )
  );
