-- Time único neste CRM: contas atuais (e as próximas) entram na mesma organização.
-- Inbox / Kanban / prospects / tags / knowledge são do time.
-- WhatsApp, disparo e prompt da Edith continuam por user_id.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Organização',
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create unique index if not exists organization_members_user_uidx
  on public.organization_members (user_id);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

grant select on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant all on public.organizations to service_role;
grant all on public.organization_members to service_role;

create or replace function public.org_user_ids(_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select peer.user_id
  from public.organization_members me
  join public.organization_members peer on peer.org_id = me.org_id
  where me.user_id = _uid
  union
  select _uid
  where _uid is not null;
$$;

create or replace function public.same_org(_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _uid is not null and exists (
    select 1
    from public.organization_members me
    join public.organization_members peer on peer.org_id = me.org_id
    where me.user_id = auth.uid()
      and peer.user_id = _uid
  );
$$;

revoke all on function public.org_user_ids(uuid) from public, anon;
revoke all on function public.same_org(uuid) from public, anon;
grant execute on function public.org_user_ids(uuid) to authenticated, service_role;
grant execute on function public.same_org(uuid) to authenticated, service_role;

create or replace function public.my_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.organization_members where user_id = auth.uid() limit 1;
$$;

revoke all on function public.my_org_id() from public, anon;
grant execute on function public.my_org_id() to authenticated, service_role;

drop policy if exists org_select_organizations on public.organizations;
create policy org_select_organizations on public.organizations
  for select to authenticated
  using (id = public.my_org_id());

drop policy if exists org_select_members on public.organization_members;
create policy org_select_members on public.organization_members
  for select to authenticated
  using (org_id = public.my_org_id());

-- RLS do time (não mexe em WhatsApp / agent_configs / openers / outreach_sends).
drop policy if exists own_conversations on public.conversations;
create policy org_conversations on public.conversations
  for all to authenticated
  using (public.same_org(user_id))
  with check (public.same_org(user_id));

drop policy if exists own_messages on public.messages;
create policy org_messages on public.messages
  for all to authenticated
  using (public.same_org(user_id))
  with check (public.same_org(user_id));

drop policy if exists "Users manage their own stages" on public.pipeline_stages;
create policy org_pipeline_stages on public.pipeline_stages
  for all to authenticated
  using (public.same_org(user_id))
  with check (public.same_org(user_id));

drop policy if exists own_prospects on public.prospects;
create policy org_prospects on public.prospects
  for all to authenticated
  using (public.same_org(user_id))
  with check (public.same_org(user_id));

drop policy if exists "Users manage their own followups" on public.followups;
create policy org_followups on public.followups
  for all to authenticated
  using (public.same_org(user_id))
  with check (public.same_org(user_id));

drop policy if exists own_knowledge_base on public.knowledge_base;
create policy org_knowledge_base on public.knowledge_base
  for all to authenticated
  using (public.same_org(user_id))
  with check (public.same_org(user_id));

drop policy if exists own_lead_tags on public.lead_tags;
create policy org_lead_tags on public.lead_tags
  for all to authenticated
  using (public.same_org(user_id))
  with check (public.same_org(user_id));

drop policy if exists own_conversation_tags on public.conversation_tags;
drop policy if exists org_conversation_tags on public.conversation_tags;
create policy org_conversation_tags on public.conversation_tags
  for all to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and public.same_org(c.user_id)
    )
    and exists (
      select 1 from public.lead_tags t
      where t.id = tag_id and public.same_org(t.user_id)
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and public.same_org(c.user_id)
    )
    and exists (
      select 1 from public.lead_tags t
      where t.id = tag_id and public.same_org(t.user_id)
    )
  );

drop policy if exists own_outreach_sends on public.outreach_sends;
create policy org_outreach_sends on public.outreach_sends
  for select to authenticated
  using (public.same_org(user_id));

drop policy if exists org_view_whatsapp_instances on public.whatsapp_instances;
create policy org_view_whatsapp_instances on public.whatsapp_instances
  for select to authenticated
  using (public.same_org(user_id));


-- Uma org, todos os usuários atuais e os próximos.
insert into public.organizations (name)
select 'ProspectIA'
where not exists (select 1 from public.organizations);

insert into public.organization_members (org_id, user_id)
select o.id, u.id
from public.organizations o
cross join auth.users u
on conflict do nothing;

-- Um kanban só: etapas duplicadas da 2ª conta somem; "Fechado" extra passa para o dono.
do $$
declare
  owner uuid;
begin
  select id into owner from auth.users order by created_at limit 1;
  if owner is null then
    return;
  end if;

  update public.conversations c
  set stage_id = owner_stage.id
  from public.pipeline_stages peer
  join public.pipeline_stages owner_stage
    on owner_stage.user_id = owner
   and lower(btrim(owner_stage.name)) = lower(btrim(peer.name))
  where c.stage_id = peer.id
    and peer.user_id <> owner;

  update public.pipeline_stages s
  set
    user_id = owner,
    position = (select coalesce(max(p.position), -1) + 1 from public.pipeline_stages p where p.user_id = owner)
  where s.user_id <> owner
    and not exists (
      select 1 from public.pipeline_stages o
      where o.user_id = owner
        and lower(btrim(o.name)) = lower(btrim(s.name))
    );

  delete from public.pipeline_stages s
  where s.user_id <> owner
    and not exists (select 1 from public.conversations c where c.stage_id = s.id);
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_count integer;
  v_org uuid;
  v_has_stages boolean;
begin
  insert into public.profiles (user_id, email, full_name)
  values (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');

  select count(*) into admin_count from public.user_roles where role = 'admin';
  if admin_count = 0 then
    insert into public.user_roles (user_id, role) values (NEW.id, 'admin')
    on conflict do nothing;
  else
    insert into public.user_roles (user_id, role) values (NEW.id, 'user')
    on conflict do nothing;
  end if;

  perform public.seed_tenant(NEW.id);

  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then
    insert into public.organizations (name) values ('ProspectIA') returning id into v_org;
  end if;
  insert into public.organization_members (org_id, user_id)
  values (v_org, NEW.id)
  on conflict do nothing;

  select exists (
    select 1
    from public.pipeline_stages s
    where s.user_id in (select public.org_user_ids(NEW.id))
      and s.user_id <> NEW.id
  ) into v_has_stages;
  if not v_has_stages then
    perform public.seed_pipeline_stages(NEW.id);
  end if;

  return NEW;
end;
$$;

create or replace function public.stage_novo_prospect(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user is null then
    return null;
  end if;

  select id into v_id
  from public.pipeline_stages
  where user_id in (select public.org_user_ids(p_user))
    and lower(btrim(name)) in ('novo prospect', 'novo lead')
  order by case when lower(btrim(name)) = 'novo prospect' then 0 else 1 end, position
  limit 1;

  if v_id is null then
    insert into public.pipeline_stages (user_id, name, position, color)
    values (p_user, 'Novo Prospect', 0, '#3FB8BE')
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.conversation_on_first_inbound()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_stage uuid;
  v_prev int;
begin
  if new.direction is distinct from 'inbound' then
    return new;
  end if;

  select count(*) into v_prev
  from public.messages
  where conversation_id = new.conversation_id
    and direction = 'inbound'
    and id is distinct from new.id;
  if v_prev > 0 then
    return new;
  end if;

  v_user := new.user_id;
  if v_user is null then
    select user_id into v_user
    from public.conversations
    where id = new.conversation_id;
  end if;
  if v_user is null then
    return new;
  end if;

  select id into v_stage
  from public.pipeline_stages
  where user_id in (select public.org_user_ids(v_user))
    and lower(btrim(name)) = 'em contato'
  order by position
  limit 1;

  if v_stage is null then
    insert into public.pipeline_stages (user_id, name, position, color)
    values (v_user, 'Em contato', 1, '#F59E0B')
    returning id into v_stage;
  end if;

  update public.conversations
  set stage_id = v_stage
  where id = new.conversation_id;

  return new;
end;
$$;

create or replace function public.place_prospect_novo_prospect(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.prospects;
  v_stage uuid;
  v_conv public.conversations;
begin
  select * into v_p from public.prospects where id = p_id;
  if not found then
    return;
  end if;

  v_stage := public.stage_novo_prospect(v_p.user_id);
  if v_stage is null then
    return;
  end if;

  if v_p.conversation_id is not null then
    select * into v_conv
    from public.conversations
    where id = v_p.conversation_id
      and user_id in (select public.org_user_ids(v_p.user_id));
  else
    select * into v_conv
    from public.conversations
    where user_id in (select public.org_user_ids(v_p.user_id))
      and contact_phone = v_p.phone
    order by case when user_id = v_p.user_id then 0 else 1 end, last_message_at desc
    limit 1;
  end if;

  if v_conv.id is not null then
    if exists (
      select 1 from public.messages m
      where m.conversation_id = v_conv.id
        and m.direction = 'inbound'
    ) then
      if v_p.conversation_id is null then
        update public.prospects
        set conversation_id = v_conv.id
        where id = v_p.id;
      end if;
      return;
    end if;

    update public.conversations
    set stage_id = v_stage,
        contact_name = coalesce(contact_name, v_p.name),
        contact_company = coalesce(contact_company, v_p.company),
        contact_city = coalesce(contact_city, v_p.city),
        wa_phone = coalesce(wa_phone, v_p.phone)
    where id = v_conv.id;

    update public.prospects
    set conversation_id = v_conv.id
    where id = v_p.id and conversation_id is distinct from v_conv.id;
    return;
  end if;

  insert into public.conversations (
    user_id, contact_phone, wa_phone, contact_name, contact_company, contact_city,
    ai_stage, ai_enabled, stage_id
  ) values (
    v_p.user_id, v_p.phone, v_p.phone, v_p.name, v_p.company, v_p.city,
    'abordar', true, v_stage
  )
  returning * into v_conv;

  update public.prospects
  set conversation_id = v_conv.id
  where id = v_p.id;
exception
  when unique_violation then
    select * into v_conv
    from public.conversations
    where user_id in (select public.org_user_ids(v_p.user_id))
      and contact_phone = v_p.phone
    order by case when user_id = v_p.user_id then 0 else 1 end, last_message_at desc
    limit 1;
    if v_conv.id is not null then
      update public.prospects
      set conversation_id = v_conv.id
      where id = v_p.id and conversation_id is distinct from v_conv.id;
    end if;
end;
$$;
