-- =============================================================================
-- Q7 Pipeline — agendamento dos crons (follow-ups + disparo frio)
-- =============================================================================
-- Roda `run-followups` e `run-outreach` a cada minuto.
-- Bônus: mantém o projeto Free "ativo" (projetos Free pausam após 7 dias parados).
--
-- ANTES DE EXECUTAR, substitua os 2 placeholders:
--   <PROJECT_REF>  → o ref do seu projeto Supabase (ex.: abcdwxyz1234)
--   <ANON_KEY>     → sua anon / publishable key
-- Local: troque https://<PROJECT_REF>.supabase.co por http://kong:8000
--
-- Pré-requisito: extensões pg_cron e pg_net habilitadas
-- (Database > Extensions no painel do Supabase).
--
-- É idempotente: pode rodar de novo que ele reagenda em vez de duplicar.
-- O secret do disparo NÃO vai no SQL: o job lê app_settings a cada tick (ADR-09).
-- =============================================================================

-- Remove agendamentos anteriores, se existirem (evita jobs duplicados)
DO $$
BEGIN
  PERFORM cron.unschedule('run-followups-every-minute');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('run-outreach-every-minute');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'run-followups-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://<PROJECT_REF>.supabase.co/functions/v1/run-followups',
    headers:='{"Content-Type":"application/json","apikey":"<ANON_KEY>","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
    body:=concat('{"time":"', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'run-outreach-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/run-outreach',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM public.app_settings WHERE key = 'outreach_cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Conferir se ficou ativo (esperado: 2 linhas, schedule '* * * * *', active = true):
--   SELECT jobid, jobname, schedule, active FROM cron.job;
--
-- Ver as últimas execuções:
--   SELECT status, return_message, start_time
--   FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--
-- Para remover depois:
--   SELECT cron.unschedule('run-followups-every-minute');
--   SELECT cron.unschedule('run-outreach-every-minute');
