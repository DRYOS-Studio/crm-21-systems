alter table public.agent_configs
  add column if not exists ai_provider text not null default 'groq',
  add column if not exists ai_api_key text,
  add column if not exists ai_model text;

alter table public.agent_configs
  drop constraint if exists agent_configs_ai_provider_check;
alter table public.agent_configs
  add constraint agent_configs_ai_provider_check
  check (ai_provider in ('groq', 'openai', 'gemini', 'claude'));
