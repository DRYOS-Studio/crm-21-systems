create or replace function public.save_openers(p_texts text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_company text;
begin
  if v_uid is null or not private.member_has_module(v_uid, 'prospecting') then
    raise exception 'save_openers: access denied' using errcode = '42501';
  end if;
  if p_texts is null or coalesce(array_length(p_texts, 1), 0) < 2 then
    raise exception 'save_openers: precisa de pelo menos 2 variações';
  end if;
  select company_name into v_company from public.agent_configs where user_id=v_uid;
  if exists (select 1 from unnest(p_texts) as t(txt) where txt like '%{empresa}%')
    and coalesce(btrim(v_company), '') = '' then
    raise exception 'save_openers: {empresa} exige company_name';
  end if;
  delete from public.outreach_openers where user_id=v_uid;
  insert into public.outreach_openers(user_id,text,active)
  select v_uid, t, true from unnest(p_texts) as t;
end;
$$;
revoke all on function public.save_openers(text[]) from public, anon;
grant execute on function public.save_openers(text[]) to authenticated;
