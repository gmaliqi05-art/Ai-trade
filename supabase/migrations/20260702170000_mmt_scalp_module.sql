-- MMT-SCALP (Blic): modul afat-shkurtër 1m me ON/OFF + cron çdo 1 MINUTË
-- (scalp kontrollon çdo minutë; skanimi i plotë swing mbetet në kufijtë 5-min).
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS scalp_on boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scalp_tp_rr numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS scalp_max_day integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS scalp_cooldown_min integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS scalp_time_stop_min integer NOT NULL DEFAULT 15;

SELECT cron.unschedule('mmt-engine-every-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mmt-engine-every-5min');
SELECT cron.unschedule('mmt-engine-every-1min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mmt-engine-every-1min');
SELECT cron.schedule('mmt-engine-every-1min', '* * * * *', $cron$
  SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/mmt-engine',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$cron$);
