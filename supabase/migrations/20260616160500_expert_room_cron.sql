-- ============================================================
-- DHOMA E EKSPERTËVE — cron nonstop: kontrollon çdo 10 min dhe, sa herë grumbullohen
-- 20 trade auto (TP/SL), nxjerr një raport të ri + njofton admin-at (push + dashboard).
-- Funksioni vetë e bën gate-in (BATCH=20): nëse < 20 pa-analizuara → s'bën gjë.
-- Përdor të njëjtin x-cron-secret si jobs-at e tjerë.
-- ============================================================
SELECT cron.unschedule('expert-room-every-10min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expert-room-every-10min');

SELECT cron.schedule('expert-room-every-10min', '*/10 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/expert-room',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$cron$);
