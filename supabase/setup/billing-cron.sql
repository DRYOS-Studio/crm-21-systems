-- Execute em cada projeto Supabase de instalação após a migration 20260930170000.
-- pg_cron e pg_net precisam estar habilitados no projeto.
-- Substitua <PROJECT_REF> e <ANON_KEY>. O segredo é criado pela migration e lido de app_settings.

DO $$
BEGIN
  PERFORM cron.unschedule('q7-sync-billing-every-minute');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'q7-sync-billing-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-billing-state',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<ANON_KEY>',
      'Authorization', 'Bearer <ANON_KEY>',
      'x-cron-secret', (SELECT value FROM public.app_settings WHERE key = 'q7_billing_sync_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
