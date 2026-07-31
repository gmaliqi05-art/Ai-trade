-- Ndal postimin automatik të sinjaleve të MOTORIT të platformës në Telegram (kërkesa e pronarit).
-- Në kanal duhet të shkojnë VETËM sinjalet e marra nga platforma e jashtme GoldSniperFX
-- (platform-poll → telegram-signals → postToOwnerChannel, dhe webhook-u gold-sniper-ingest).
-- Funksioni gold-sniper-auto u bë no-op në kod; këtu hiqet edhe cron job-i që e thërriste çdo 1 min.
-- (U ekzekutua tashmë live më 2026-07-31; këtu ruhet për regjistrin e migrimeve — idempotent.)
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'gold-sniper-auto' limit 1;
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;
