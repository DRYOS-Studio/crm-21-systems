create table public.conversation_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  event_type text not null check (event_type in ('qualification_updated','human_handoff','converted','followup_sent')),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index conversation_events_org_time_idx on public.conversation_events(user_id, occurred_at desc);
alter table public.conversation_events enable row level security;
grant select on public.conversation_events to authenticated;
grant all on public.conversation_events to service_role;
create policy org_select_conversation_events on public.conversation_events
  for select to authenticated using (public.same_org(user_id));

create or replace function public.capture_conversation_metric_events()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_stage_name text;
begin
  if new.qualification is distinct from old.qualification
    and new.qualification <> '{}'::jsonb then
    insert into public.conversation_events(user_id,conversation_id,event_type)
    values(new.user_id,new.id,'qualification_updated');
  end if;
  if old.ai_enabled and not new.ai_enabled and new.human_takeover_at is not null then
    insert into public.conversation_events(user_id,conversation_id,event_type)
    values(new.user_id,new.id,'human_handoff');
  end if;
  if new.stage_id is distinct from old.stage_id and new.stage_id is not null then
    select name into v_stage_name from public.pipeline_stages where id = new.stage_id;
    if lower(coalesce(v_stage_name,'')) ~ '(fechad|ganh|convert)' then
      insert into public.conversation_events(user_id,conversation_id,event_type,metadata)
      values(new.user_id,new.id,'converted',jsonb_build_object('stage',v_stage_name));
    end if;
  end if;
  return new;
end;
$$;
create trigger capture_conversation_metric_events
  after update of qualification, ai_enabled, stage_id on public.conversations
  for each row execute function public.capture_conversation_metric_events();

create or replace function public.capture_followup_metric_event()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'sent' and new.sent_at is not null and old.status is distinct from 'sent' then
    insert into public.conversation_events(user_id,conversation_id,event_type,occurred_at,metadata)
    values(new.user_id,new.conversation_id,'followup_sent',new.sent_at,jsonb_build_object('kind',new.kind));
  end if;
  return new;
end;
$$;
create trigger capture_followup_metric_event
  after update of status, sent_at on public.followups
  for each row execute function public.capture_followup_metric_event();
