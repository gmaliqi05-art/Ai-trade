-- Cron: vlerëson sinjalet aktive çdo 2 min (a arritën TP/SL/skadim).
select cron.schedule(
  'signal-eval-every-2min',
  '*/2 * * * *',
  $$ SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/signal-eval',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb
  ); $$
);
