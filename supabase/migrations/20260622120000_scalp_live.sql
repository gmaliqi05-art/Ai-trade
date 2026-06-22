-- ============================================================
-- SCALP-LIVE: robot scalping në "kohë reale" (cikël brenda minutës).
-- Modalitet i RI, krah për krah me robotin ekzistues (s'e prek formulën fituese).
-- Funksioni `scalp-live` nis çdo minutë nga cron, por brenda vetes bën një cikël ~50s
-- duke ndjekur tick-un live (~çdo 2.5s): hyn shpejt në momentum, mbron fitimin shpejt,
-- del në kthesë me një hapësirë të vogël (lejon ri-test). SL "katastrofe" te brokeri si rrjetë sigurie.
--
-- Aplikohet edhe operacionalisht në prodhim; ky skedar e mban në version control.
-- ============================================================

-- 1) Cilësimet per-përdorues (në metaapi_config). Të gjitha opt-in / me default të sigurt.
alter table public.metaapi_config
  add column if not exists scalp_live_enabled    boolean   not null default false,           -- ndez/fik robotin scalp-live
  add column if not exists scalp_live_lot         numeric            default 0.01,             -- lot fiks (i vogël) për scalp-live
  add column if not exists scalp_live_symbols     text               default 'XAUUSD',         -- simbolet (CSV); fillimisht vetëm ari
  add column if not exists scalp_live_max_trades  smallint           default 1,                -- pozicione scalp-live njëkohësisht
  add column if not exists scalp_live_grab_usd    numeric            default 0.50,             -- marzha e fitimit (lëvizje çmimi) ku aktivizohet mbrojtja
  add column if not exists scalp_live_giveback_usd numeric           default 0.25,             -- sa fitim lejohet të kthehet nga maja para mbylljes
  add column if not exists scalp_live_cut_usd     numeric            default 0.60,             -- prerje e hershme e humbjes (hapësira e ri-testit)
  add column if not exists scalp_live_catastrophe_usd numeric        default 1.50;             -- SL i gjerë te brokeri (parashutë nëse funksioni bie)

-- 2) Lock i DEDIKUAR (i ndarë nga runner_lock i auto-trade-runner, që të mos bllokojnë njëri-tjetrin).
create table if not exists public.scalp_live_lock (
  id smallint primary key default 1,
  locked_at timestamptz,
  constraint scalp_live_lock_single check (id = 1)
);
insert into public.scalp_live_lock (id, locked_at) values (1, null) on conflict (id) do nothing;
alter table public.scalp_live_lock enable row level security;
-- Pa politika klienti → vetëm service-role (runner-i) e prek.

-- 3) Cron: nis scalp-live çdo minutë (funksioni vetë bën ciklin ~50s brenda minutës).
select cron.schedule('scalp-live-every-1min', '* * * * *', $cron$
  select net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/scalp-live',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$cron$);
