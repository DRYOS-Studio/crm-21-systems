-- Intervalo configurável entre abordagens (números diferentes).
alter table public.agent_configs
  add column if not exists outreach_interval_sec integer not null default 90;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agent_configs_outreach_interval_sec_chk'
  ) then
    alter table public.agent_configs
      add constraint agent_configs_outreach_interval_sec_chk
      check (outreach_interval_sec >= 30 and outreach_interval_sec <= 600);
  end if;
end $$;
