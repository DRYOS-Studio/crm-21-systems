alter table public.organizations
  add column if not exists extra_users integer not null default 0 check (extra_users >= 0),
  add column if not exists extra_whatsapp_channels integer not null default 0 check (extra_whatsapp_channels >= 0);

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  admin_count integer;
  v_org uuid;
  v_has_stages boolean;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is not null then
    perform 1 from public.organizations where id = v_org for update;
    if (select count(*) from public.organization_members where org_id = v_org)
      >= 5 + (select extra_users from public.organizations where id = v_org) then
      raise exception 'Limite de usuários da empresa atingido' using errcode = '23514';
    end if;
  end if;

  insert into public.profiles (user_id, email, full_name)
  values (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  select count(*) into admin_count from public.user_roles where role = 'admin';
  if admin_count = 0 then
    insert into public.user_roles (user_id, role) values (NEW.id, 'admin') on conflict do nothing;
  else
    insert into public.user_roles (user_id, role) values (NEW.id, 'user') on conflict do nothing;
  end if;
  perform public.seed_tenant(NEW.id);
  if v_org is null then
    insert into public.organizations (name) values ('ProspectIA') returning id into v_org;
  end if;
  insert into public.organization_members (org_id, user_id) values (v_org, NEW.id) on conflict do nothing;
  select exists (
    select 1 from public.pipeline_stages s
    where s.user_id in (select public.org_user_ids(NEW.id)) and s.user_id <> NEW.id
  ) into v_has_stages;
  if not v_has_stages then perform public.seed_pipeline_stages(NEW.id); end if;
  return NEW;
end;
$$;

create or replace function public.enforce_whatsapp_channel_quota()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_extra integer;
begin
  select org_id into v_org from public.organization_members where user_id = NEW.user_id;
  if v_org is null then raise exception 'Empresa não encontrada' using errcode = '23514'; end if;
  perform 1 from public.organizations where id = v_org for update;
  select extra_whatsapp_channels into v_extra from public.organizations where id = v_org;
  if (select count(*) from public.whatsapp_instances i
      join public.organization_members m on m.user_id = i.user_id
      where m.org_id = v_org and (TG_OP = 'INSERT' or i.id <> NEW.id)) >= 1 + v_extra then
    raise exception 'Limite de canais WhatsApp da empresa atingido' using errcode = '23514';
  end if;
  return NEW;
end;
$$;

drop trigger if exists enforce_whatsapp_channel_quota on public.whatsapp_instances;
create trigger enforce_whatsapp_channel_quota
  before insert or update of user_id on public.whatsapp_instances
  for each row execute function public.enforce_whatsapp_channel_quota();
