create table if not exists public.q7_installations (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  slug text not null unique,
  subdomain text unique,
  supabase_project_ref text unique,
  vercel_project_ref text,
  release_tag text,
  database_version text,
  functions_version text,
  frontend_version text,
  asaas_customer_id text,
  asaas_subscription_id text unique,
  asaas_setup_lock_at timestamptz,
  payment_url text,
  sync_token_hash text not null,
  billing_status text not null default 'active'
    check (billing_status in ('active', 'past_due', 'blocked', 'cancelled')),
  billing_due_date date,
  grace_ends_at timestamptz,
  last_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sync_token_hash ~ '^[0-9a-f]{64}$')
);

alter table public.q7_installations enable row level security;
revoke all on public.q7_installations from anon, authenticated;
grant all on public.q7_installations to service_role;

create table if not exists public.q7_billing_events (
  id uuid primary key default gen_random_uuid(),
  asaas_event_id text not null unique,
  event_type text not null,
  payment_id text not null,
  subscription_id text,
  due_date date,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0,
  locked_at timestamptz,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists q7_billing_events_queue_idx
  on public.q7_billing_events (received_at)
  where status in ('pending', 'processing');

create or replace function public.q7_grace_ends_at(_due_date date)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select ((_due_date + 6)::timestamp at time zone 'America/Sao_Paulo');
$$;

revoke all on function public.q7_grace_ends_at(date) from public, anon, authenticated;
grant execute on function public.q7_grace_ends_at(date) to service_role;

alter table public.q7_billing_events enable row level security;
revoke all on public.q7_billing_events from anon, authenticated;
grant all on public.q7_billing_events to service_role;

create or replace function public.q7_claim_billing_events(_limit integer default 20)
returns setof public.q7_billing_events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select e.id
    from public.q7_billing_events e
    where e.attempts < 12
      and (e.status = 'pending' or (e.status = 'processing' and e.locked_at < now() - interval '5 minutes'))
    order by e.received_at
    for update skip locked
    limit greatest(1, least(_limit, 100))
  )
  update public.q7_billing_events e
  set status = 'processing', locked_at = now(), attempts = e.attempts + 1
  from picked
  where e.id = picked.id
  returning e.*;
end;
$$;

revoke all on function public.q7_claim_billing_events(integer) from public, anon, authenticated;
grant execute on function public.q7_claim_billing_events(integer) to service_role;

create or replace function public.q7_claim_asaas_setup(_installation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.q7_installations
  set asaas_setup_lock_at = now()
  where id = _installation_id
    and asaas_subscription_id is null
    and (asaas_setup_lock_at is null or asaas_setup_lock_at < now() - interval '5 minutes');
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.q7_claim_asaas_setup(uuid) from public, anon, authenticated;
grant execute on function public.q7_claim_asaas_setup(uuid) to service_role;

create table if not exists public.q7_local_access (
  singleton boolean primary key default true check (singleton),
  billing_status text not null default 'active'
    check (billing_status in ('active', 'past_due', 'blocked', 'cancelled')),
  grace_ends_at timestamptz,
  payment_url text,
  synchronized_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.q7_local_access (singleton, billing_status)
values (true, 'active')
on conflict (singleton) do nothing;

insert into public.app_settings (key, value)
values
  ('q7_billing_sync_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  ('q7_billing_process_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

alter table public.q7_local_access enable row level security;
revoke all on public.q7_local_access from anon;
grant select on public.q7_local_access to authenticated;
grant all on public.q7_local_access to service_role;

drop policy if exists q7_users_read_local_access on public.q7_local_access;
create policy q7_users_read_local_access on public.q7_local_access
  for select to authenticated using (true);
