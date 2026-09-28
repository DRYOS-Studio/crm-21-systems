-- Ticks de envio / entrega / leitura (WhatsApp via Uazapi messages_update).

alter table public.messages
  add column if not exists wa_status text;

alter table public.messages drop constraint if exists messages_wa_status_check;
alter table public.messages
  add constraint messages_wa_status_check
  check (wa_status is null or wa_status in ('sent', 'delivered', 'read', 'failed'));

create or replace function public.message_set_wa_status(p_external_id text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank int;
  v_cur int;
begin
  if p_external_id is null or btrim(p_external_id) = '' then
    return;
  end if;
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    return;
  end if;

  v_rank := case p_status
    when 'sent' then 1
    when 'delivered' then 2
    when 'read' then 3
    when 'failed' then 0
  end;

  select case wa_status
    when 'read' then 3
    when 'delivered' then 2
    when 'sent' then 1
    when 'failed' then 0
    else 0
  end
  into v_cur
  from public.messages
  where external_id = p_external_id
    and direction = 'outbound'
  limit 1;

  if not found then
    return;
  end if;

  if p_status = 'failed' or v_rank >= v_cur then
    update public.messages
    set wa_status = p_status
    where external_id = p_external_id
      and direction = 'outbound';
  end if;
end;
$$;

revoke all on function public.message_set_wa_status(text, text) from public, anon;
grant execute on function public.message_set_wa_status(text, text) to service_role;
