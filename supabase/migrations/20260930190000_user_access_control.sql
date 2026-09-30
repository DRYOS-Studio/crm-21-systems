-- Per-member module and WhatsApp instance access.

alter table public.organization_members
  add column if not exists is_active boolean not null default true,
  add column if not exists access_review_required boolean not null default false;

create table if not exists public.organization_member_modules (
  org_id uuid not null,
  user_id uuid not null,
  module_key text not null check (module_key in ('crm_conversations', 'prospecting', 'settings')),
  granted_at timestamptz not null default now(),
  primary key (org_id, user_id, module_key),
  foreign key (org_id, user_id) references public.organization_members(org_id, user_id) on delete cascade
);

create table if not exists public.organization_member_instances (
  org_id uuid not null,
  user_id uuid not null,
  instance_id uuid not null references public.whatsapp_instances(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (org_id, user_id, instance_id),
  foreign key (org_id, user_id) references public.organization_members(org_id, user_id) on delete cascade
);

alter table public.organization_member_modules enable row level security;
alter table public.organization_member_instances enable row level security;
revoke all on public.organization_member_modules, public.organization_member_instances from anon, authenticated;
grant all on public.organization_member_modules, public.organization_member_instances to service_role;

-- Preserve existing effective access. Admins use the bypass and do not need rows.
insert into public.organization_member_modules (org_id, user_id, module_key)
select om.org_id, om.user_id, module_key
from public.organization_members om
cross join (values ('crm_conversations'), ('prospecting'), ('settings')) as modules(module_key)
where not private.has_role(om.user_id, 'admin'::public.app_role)
on conflict do nothing;

insert into public.organization_member_instances (org_id, user_id, instance_id)
select member.org_id, member.user_id, wi.id
from public.organization_members member
join public.organization_members owner on owner.org_id = member.org_id
join public.whatsapp_instances wi on wi.user_id = owner.user_id
where not private.has_role(member.user_id, 'admin'::public.app_role)
on conflict do nothing;

update public.organization_members om
set access_review_required = true
where not private.has_role(om.user_id, 'admin'::public.app_role);

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
    select 1
    from public.organization_member_instances mi
    join public.organization_members om using (org_id, user_id)
    where mi.user_id = _user_id and mi.instance_id = _instance_id and om.is_active
      and (private.has_role(_user_id, 'admin'::public.app_role)
        or exists (select 1 from public.organization_members owner
                   join public.whatsapp_instances wi on wi.user_id = owner.user_id
                   where owner.org_id = om.org_id and wi.id = mi.instance_id))
  ) or (private.member_is_active(_user_id)
        and private.has_role(_user_id, 'admin'::public.app_role)
        and exists (select 1 from public.whatsapp_instances wi where wi.id = _instance_id));
$$;

create or replace function private.can_access_conversation(_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    where c.id = _conversation_id
      and public.same_org(c.user_id)
      and private.member_has_module(auth.uid(), 'crm_conversations')
      and (c.instance_id is null or private.member_has_instance(auth.uid(), c.instance_id))
  );
$$;

revoke all on function private.member_is_active(uuid) from public, anon;
revoke all on function private.member_has_module(uuid, text) from public, anon;
revoke all on function private.member_has_instance(uuid, uuid) from public, anon;
revoke all on function private.can_access_conversation(uuid) from public, anon;
grant execute on function private.member_is_active(uuid) to authenticated, service_role;
grant execute on function private.member_has_module(uuid, text) to authenticated, service_role;
grant execute on function private.member_has_instance(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_access_conversation(uuid) to authenticated, service_role;

-- Replace every policy on these protected tables to avoid permissive-policy OR bypasses.
do $$
declare t text; p record;
begin
  foreach t in array array['conversations','messages','followups','conversation_events',
    'whatsapp_instances','conversation_tags','pipeline_stages'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

create policy member_conversations on public.conversations for all to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations')
    and (instance_id is null or private.member_has_instance(auth.uid(), instance_id)))
  with check (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations')
    and (instance_id is null or private.member_has_instance(auth.uid(), instance_id)));

create policy member_messages on public.messages for all to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations')
    and private.can_access_conversation(conversation_id))
  with check (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations')
    and private.can_access_conversation(conversation_id));

create policy member_followups on public.followups for all to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations')
    and private.can_access_conversation(conversation_id))
  with check (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations')
    and private.can_access_conversation(conversation_id));

create policy member_conversation_events on public.conversation_events for select to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'dashboard')
    and private.can_access_conversation(conversation_id));

create policy member_conversation_tags on public.conversation_tags for all to authenticated
  using (private.can_access_conversation(conversation_id)
    and exists (select 1 from public.lead_tags lt where lt.id = tag_id and public.same_org(lt.user_id)))
  with check (private.can_access_conversation(conversation_id)
    and exists (select 1 from public.lead_tags lt where lt.id = tag_id and public.same_org(lt.user_id)));

create policy member_pipeline_stages on public.pipeline_stages for all to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations'))
  with check (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations'));

create policy member_whatsapp_instances on public.whatsapp_instances for select to authenticated
  using (private.member_has_module(auth.uid(), 'crm_conversations')
    and (private.has_role(auth.uid(), 'admin'::public.app_role)
      or private.member_has_instance(auth.uid(), id)));

-- Credentials are never readable from PostgREST. Instance configuration moves to server handlers.
revoke all on public.whatsapp_instances from anon, authenticated;
grant select (id, user_id, name, phone, profile_name, status, last_disconnected_at, created_at, updated_at)
  on public.whatsapp_instances to authenticated;
grant all on public.whatsapp_instances to service_role;

-- Other module data also requires an active membership and an explicit module grant.
do $$
declare t text; p record;
begin
  foreach t in array array['prospects','outreach_sends','outreach_openers',
    'saved_prospect_segments','lead_tags','lead_custom_fields','loss_reasons',
    'knowledge_base','agent_configs','searches','user_settings','leads'] loop
    if to_regclass(format('public.%I', t)) is not null then
      for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
        execute format('drop policy %I on public.%I', p.policyname, t);
      end loop;
    end if;
  end loop;
end $$;

create policy member_prospects on public.prospects for all to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'prospecting')
    and (conversation_id is null or private.can_access_conversation(conversation_id)))
  with check (public.same_org(user_id) and private.member_has_module(auth.uid(), 'prospecting')
    and (conversation_id is null or private.can_access_conversation(conversation_id)));
create policy member_outreach_sends on public.outreach_sends for select to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'prospecting'));
create policy member_outreach_openers on public.outreach_openers for select to authenticated
  using (auth.uid() = user_id and private.member_has_module(auth.uid(), 'prospecting'));
create policy member_saved_segments on public.saved_prospect_segments for all to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'prospecting'))
  with check (public.same_org(user_id) and private.member_has_module(auth.uid(), 'prospecting'));
create policy member_lead_tags on public.lead_tags for all to authenticated
  using (public.same_org(user_id) and (private.member_has_module(auth.uid(), 'crm_conversations')
    or private.member_has_module(auth.uid(), 'prospecting')))
  with check (public.same_org(user_id) and (private.member_has_module(auth.uid(), 'crm_conversations')
    or private.member_has_module(auth.uid(), 'prospecting')));
create policy member_lead_custom_fields on public.lead_custom_fields for all to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations'))
  with check (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations'));
create policy member_loss_reasons on public.loss_reasons for all to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations'))
  with check (public.same_org(user_id) and private.member_has_module(auth.uid(), 'crm_conversations'));
create policy member_knowledge_base on public.knowledge_base for all to authenticated
  using (public.same_org(user_id) and private.member_has_module(auth.uid(), 'settings'))
  with check (public.same_org(user_id) and private.member_has_module(auth.uid(), 'settings'));
create policy member_agent_configs on public.agent_configs for all to authenticated
  using (auth.uid() = user_id and private.member_has_module(auth.uid(), 'settings')
    and (outreach_instance_id is null or private.member_has_instance(auth.uid(), outreach_instance_id)))
  with check (auth.uid() = user_id and private.member_has_module(auth.uid(), 'settings')
    and (outreach_instance_id is null or private.member_has_instance(auth.uid(), outreach_instance_id)));
create policy member_searches on public.searches for all to authenticated
  using (auth.uid() = user_id and private.member_has_module(auth.uid(), 'prospecting'))
  with check (auth.uid() = user_id and private.member_has_module(auth.uid(), 'prospecting'));
create policy member_user_settings on public.user_settings for all to authenticated
  using (auth.uid() = user_id and private.member_has_module(auth.uid(), 'prospecting'))
  with check (auth.uid() = user_id and private.member_has_module(auth.uid(), 'prospecting'));

-- The legacy leads table is not present in every installation; apply only when it exists.
do $$ begin
  if to_regclass('public.leads') is not null then
    execute 'create policy member_leads on public.leads for all to authenticated using (public.same_org(user_id) and private.member_has_module(auth.uid(), ''crm_conversations'')) with check (public.same_org(user_id) and private.member_has_module(auth.uid(), ''crm_conversations''))';
  end if;
end $$;

-- A member cannot convert an assigned conversation into an organization-wide row.
create or replace function private.guard_conversation_instance_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.has_role(auth.uid(), 'admin'::public.app_role)
     and (old.instance_id is distinct from new.instance_id or old.user_id is distinct from new.user_id) then
    raise exception 'conversation assignment is admin managed' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_conversation_instance_change on public.conversations;
create trigger guard_conversation_instance_change before update on public.conversations
  for each row execute function private.guard_conversation_instance_change();

-- Device media must be served through an authorized, short-lived signed URL.
update storage.buckets set public = false where id = 'chat-media';
drop policy if exists chat_media_insert_own on storage.objects;
drop policy if exists chat_media_select_own on storage.objects;

revoke all on function private.guard_conversation_instance_change() from public, anon, authenticated;
