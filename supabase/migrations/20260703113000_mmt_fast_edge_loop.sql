-- MMT-FAST në infrastrukturën tonë (pa VPS): funksion-lak çdo minutë që brenda vetes
-- kontrollon qirinjtë 1s çdo ~4s. fast_runner zgjedh ekzekutuesin: 'edge' (Supabase, default)
-- ose 'vps' (worker-i Railway) — që të dy të mos tregtojnë njëkohësisht.
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS fast_runner text NOT NULL DEFAULT 'edge';

SELECT cron.unschedule('mmt-fast-loop-every-1min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mmt-fast-loop-every-1min');
SELECT cron.schedule('mmt-fast-loop-every-1min', '* * * * *', $cron$
  SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/mmt-fast-loop',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$cron$);
