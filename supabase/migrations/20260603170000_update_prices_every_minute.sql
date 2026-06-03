-- Përshpejto përditësimin e çmimeve: nga çdo 5 minuta → çdo 1 minutë.
-- Kjo i bën numrat e çmimeve (kartat/tabelat) të lëvizin më shpejt.
-- Grafiku i TradingView transmeton në kohë reale veçmas (i pavarur nga ky cron).
select cron.alter_job(
  (select jobid from cron.job where jobname = 'update-prices-every-5min'),
  schedule => '* * * * *'
);
