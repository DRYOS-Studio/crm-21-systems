-- Cada conta nova já nasce com config de disparo e toque 1 padrão.
-- Groq continua opcional. WhatsApp e fila são sempre do próprio user_id.

create or replace function public.seed_tenant(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.agent_configs (user_id)
  values (_user_id)
  on conflict (user_id) do nothing;

  if not exists (
    select 1 from public.outreach_openers where user_id = _user_id
  ) then
    insert into public.outreach_openers (user_id, text, active) values
      (_user_id, 'Olá, tudo bem?', true),
      (_user_id, 'Olá, tudo bem?', true);
  end if;
end;
$$;

revoke all on function public.seed_tenant(uuid) from public, anon, authenticated;
grant execute on function public.seed_tenant(uuid) to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_count integer;
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

  perform public.seed_pipeline_stages(NEW.id);
  perform public.seed_tenant(NEW.id);
  return NEW;
end;
$$;

insert into public.agent_configs (user_id)
select u.id
from auth.users u
where not exists (select 1 from public.agent_configs c where c.user_id = u.id);

insert into public.outreach_openers (user_id, text, active)
select u.id, v.txt, true
from auth.users u
cross join (values ('Olá, tudo bem?'), ('Olá, tudo bem?')) as v(txt)
where not exists (select 1 from public.outreach_openers o where o.user_id = u.id);
