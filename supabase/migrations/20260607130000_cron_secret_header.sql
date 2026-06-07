-- ============================================================
-- SIGURIA: porta e cron-it (vetëm akses — S'PREK logjikën e robotit/motorit).
-- Çdo cron job dërgon header-in 'x-cron-secret' (lexuar nga app_config).
-- Funksionet (fail-safe) e krahasojnë me app_config.cron_secret: nëse s'përputhet → 401.
-- Nëse sekreti s'është vendosur (ose s'lexohet dot) → lejohet (roboti s'ndalon kurrë padashje).
--
-- SHËNIM: vlera reale e 'cron_secret' vendoset OPERACIONALISHT (jo në Git), p.sh.:
--   INSERT INTO app_config(key,value) VALUES('cron_secret', <random>)
--   ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;
-- ============================================================

SELECT cron.schedule('auto-trade-runner-every-1min', '* * * * *', $cron$
  SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/auto-trade-runner',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$cron$);

SELECT cron.schedule('engine-scan-every-5min', '*/5 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/engine-scan',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$cron$);

SELECT cron.schedule('signal-eval-every-2min', '*/2 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/signal-eval',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$cron$);

SELECT cron.schedule('update-prices-every-5min', '* * * * *', $cron$
  SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/update-prices',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$cron$);
