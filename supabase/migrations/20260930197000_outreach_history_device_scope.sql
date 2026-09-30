alter table public.outreach_sends
  add column if not exists instance_id uuid references public.whatsapp_instances(id) on delete set null;

update public.outreach_sends s
set instance_id = (
  select wi.id from public.whatsapp_instances wi
  where wi.user_id=s.user_id and wi.instance_token is not null
  order by wi.updated_at desc limit 1
)
where s.instance_id is null;

drop policy if exists member_outreach_sends on public.outreach_sends;
create policy member_outreach_sends on public.outreach_sends for select to authenticated
  using (public.same_org(user_id)
    and private.member_has_module(auth.uid(), 'prospecting')
    and (instance_id is null or private.member_has_instance(auth.uid(), instance_id)));
