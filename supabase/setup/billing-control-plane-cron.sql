-- Execute somente no Supabase central da DRYOS após a migration 20260930170000.
-- pg_cron e pg_net precisam estar habilitados. Substitua <PROJECT_REF> e <ANON_KEY>.

UPDATE public.q7_local_access SET is_control_plane = true WHERE singleton = true;

DO $$
BEGIN
  PERFORM cron.unschedule('q7-process-asaas-events-every-minute');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'q7-process-asaas-events-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/process-asaas-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<ANON_KEY>',
      'Authorization', 'Bearer <ANON_KEY>',
      'x-cron-secret', (SELECT value FROM public.app_settings WHERE key = 'q7_billing_process_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
