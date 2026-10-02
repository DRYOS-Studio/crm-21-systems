create or replace function public.conversation_message_summaries(p_conversation_ids uuid[])
returns table (
  conversation_id uuid,
  last_message_id uuid,
  last_content text,
  last_direction text,
  last_sender text,
  last_created_at timestamptz,
  last_inbound_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id,
    latest.id,
    latest.content,
    latest.direction,
    latest.sender,
    latest.created_at,
    inbound.created_at
  from public.conversations c
  left join lateral (
    select m.id, m.content, m.direction, m.sender, m.created_at
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  left join lateral (
    select m.created_at
    from public.messages m
    where m.conversation_id = c.id
      and m.direction = 'inbound'
    order by m.created_at desc, m.id desc
    limit 1
  ) inbound on true
  where c.id = any(coalesce(p_conversation_ids, '{}'::uuid[]));
$$;

revoke all on function public.conversation_message_summaries(uuid[]) from public, anon;
grant execute on function public.conversation_message_summaries(uuid[]) to authenticated;
