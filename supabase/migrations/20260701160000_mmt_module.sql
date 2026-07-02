-- ============================================================
-- MMT — SUPER ROBOTI (modul KOMPLET I VEÇANTË nga motori/robotët ekzistues).
-- Faza HIJE: tregton VETËM në letër (paper) — asnjë urdhër real te brokeri.
-- Arkitektura (nga hulumtimi + 415 trade-t e MMTI + Dhoma e Ekspertëve):
--   L0 Regjimi (TREND_UP/TREND_DOWN/RANGE/TRANSITION/EVENT)
--   L1 Ansambli (trend-following + mean-reversion, secili në regjimin e vet)
--   L2 Rreziku prop-style (0.5%/trade, stop ditor, kill-switch pas 2 SL, anti-stacking)
--   L3 Roja e ngjarjeve (blackout i konfigurueshëm)
--   L4 Mbrojtja e fitimit GJITHMONË (break-even +1R, trailing pas +1.5R)
--   L5 Mësimi: parametrat ndryshohen vetëm pas validimit në hije (walk-forward)
-- ============================================================

-- Konfigurimi (rresht i vetëm) — lexohet nga mmt-engine çdo skanim; menaxhohet nga faqja MMT.
CREATE TABLE IF NOT EXISTS public.mmt_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active boolean NOT NULL DEFAULT true,              -- roboti-hije ON/OFF
  paper_equity numeric NOT NULL DEFAULT 1000,        -- kapitali i letrës ($)
  risk_pct numeric NOT NULL DEFAULT 0.5,             -- % rrezik për trade (PTJ: 1% max)
  rr numeric NOT NULL DEFAULT 4,                     -- R:R i synuar (MMTI: 1:4)
  max_open integer NOT NULL DEFAULT 2,               -- pozicione maksimale njëkohësisht
  max_same_dir integer NOT NULL DEFAULT 2,           -- anti-stacking: max në të njëjtin drejtim
  daily_stop_pct numeric NOT NULL DEFAULT 4,         -- stop ditor (% e kapitalit, prop-style)
  kill_after_sl integer NOT NULL DEFAULT 2,          -- kill-switch pas N humbjeve SL në ditë
  adx_trend_min numeric NOT NULL DEFAULT 25,         -- ADX >= kjo → trend (industri: 25)
  adx_range_max numeric NOT NULL DEFAULT 20,         -- ADX < kjo → range
  er_trend_min numeric NOT NULL DEFAULT 0.30,        -- ER >= kjo → trend i pastër
  overext_atr numeric NOT NULL DEFAULT 1.0,          -- mos SHIT brenda X*ATR të minimumit N-ditor (mësimi i 1 korrikut)
  overext_days integer NOT NULL DEFAULT 5,           -- dritarja e ekstremit (ditë)
  sessions jsonb NOT NULL DEFAULT '[[7,10],[13,17]]'::jsonb, -- kill-zones UTC (Dhoma e Ekspertëve); NY 16-21 opsionale
  blackout_until timestamptz,                        -- roja e ngjarjeve: pa hyrje të reja deri në këtë kohë
  be_at_r numeric NOT NULL DEFAULT 1.0,              -- break-even kur fitimi arrin +1R
  trail_at_r numeric NOT NULL DEFAULT 1.5,           -- trailing aktivizohet pas +1.5R
  trail_lock_pct numeric NOT NULL DEFAULT 50,        -- % e fitimit që mban trailing-u
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.mmt_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Trade-t HIJE (letër) — vlerësohen çdo skanim kundër çmimeve reale.
CREATE TABLE IF NOT EXISTS public.mmt_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL DEFAULT 'XAUUSD',
  side text NOT NULL CHECK (side IN ('BUY','SELL')),
  strategy text NOT NULL,                            -- 'trend' | 'range'
  regime text NOT NULL,                              -- regjimi në hyrje
  entry_price numeric NOT NULL,
  sl numeric NOT NULL,
  tp numeric NOT NULL,
  lots numeric NOT NULL,
  risk_usd numeric NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','tp','sl','be','trail','expired')),
  exit_price numeric,
  pnl_usd numeric,
  r_multiple numeric,
  reason text,                                       -- pse hyri (diagnostikë)
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS mmt_trades_open_idx ON public.mmt_trades(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS mmt_trades_opened_idx ON public.mmt_trades(opened_at DESC);

-- Logu i skanimeve — çdo 5 min: regjimi + vendimi + pse (transparencë e plotë).
CREATE TABLE IF NOT EXISTS public.mmt_scan_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  price numeric,
  regime text,
  decision text,                                     -- 'open_buy' | 'open_sell' | 'hold' | 'blocked'
  reject_reason text,
  adx numeric, er numeric, rsi15 numeric, atr1h numeric,
  details jsonb
);
CREATE INDEX IF NOT EXISTS mmt_scan_log_time_idx ON public.mmt_scan_log(scanned_at DESC);

-- RLS: vetëm admin lexon; shkrimi bëhet nga mmt-engine me service-role.
ALTER TABLE public.mmt_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmt_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmt_scan_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mmt_config' AND policyname='mmt_config_admin') THEN
    CREATE POLICY mmt_config_admin ON public.mmt_config FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true))
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mmt_trades' AND policyname='mmt_trades_admin_read') THEN
    CREATE POLICY mmt_trades_admin_read ON public.mmt_trades FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mmt_scan_log' AND policyname='mmt_scan_admin_read') THEN
    CREATE POLICY mmt_scan_admin_read ON public.mmt_scan_log FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));
  END IF;
END $$;

-- Cron: skanim çdo 5 min (si motori ekzistues, por funksion KREJT i veçantë).
SELECT cron.unschedule('mmt-engine-every-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mmt-engine-every-5min');
SELECT cron.schedule('mmt-engine-every-5min', '*/5 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://zwyuscgqacfpjafznybg.supabase.co/functions/v1/mmt-engine',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', COALESCE((SELECT value FROM public.app_config WHERE key='cron_secret'), '')),
    body := '{}'::jsonb
  );
$cron$);
