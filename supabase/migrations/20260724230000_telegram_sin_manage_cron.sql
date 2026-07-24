-- Telegram Sin — menaxheri i shkallëve të TP (cron çdo 1 min).
-- Kur 'move_be_after_tp1' është ON: TP1 preket → SL i legs të mbetura në breakeven;
-- TP2 preket → SL te çmimi i TP2 (kurrë më lart — hapësirë për TP3/TP4).
-- Gjithmonë: përditëson statuset (pending i mbushur → open; leg i mbyllur → closed).
SELECT cron.unschedule('telegram-sin-manage-every-1min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'telegram-sin-manage-every-1min');
SELECT cron.schedule('telegram-sin-manage-every-1min', '* * * * *', $cron$
  SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/telegram-signals?manage=1',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$cron$);
