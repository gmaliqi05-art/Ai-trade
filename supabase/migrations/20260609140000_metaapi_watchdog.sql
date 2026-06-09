-- metaapi-watchdog: kolonat e gjendjes së lidhjes + cron (çdo 2 min).
-- Aplikuar live përmes MCP; ruajtur këtu për version-control / riprodhim.

ALTER TABLE public.metaapi_config
  ADD COLUMN IF NOT EXISTS disconnect_since timestamptz,
  ADD COLUMN IF NOT EXISTS last_redeploy_at timestamptz,
  ADD COLUMN IF NOT EXISTS disconnect_alerted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS conn_fail_count integer NOT NULL DEFAULT 0;

-- Cron: thërret watchdog-un çdo 2 minuta.
SELECT cron.schedule('metaapi-watchdog-every-2min', '*/2 * * * *', $job$
  SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/metaapi-watchdog',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$job$);
