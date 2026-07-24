-- Heqja e MMT-Fast nga platforma (kërkesë e përdoruesit, 24 korrik):
-- përdoruesi kaloi te roboti Telegram Sin dhe MMT-Fast nuk duhet të ekzekutohet më.
-- U fshinë: worker/ (Railway worker), supabase/functions/mmt-fast-loop, railway.json i rrënjës,
-- workflow-i i deploy-it. Këtu heqim cron-in (idempotent — s'dështon nëse s'ekziston).
SELECT cron.unschedule('mmt-fast-loop-every-1min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mmt-fast-loop-every-1min');
