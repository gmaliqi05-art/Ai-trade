-- MMTI — Faza C (SKELET, modaliteti SHADOW).
-- MMTI provon strategjinë e optimizuar mbi sinjalet REALE, PA para, PA MetaApi, PA prekur
-- robotin aktual. Asgjë s'tregton vërtet derisa të kalohen ~100 trade + miratimi.
--
-- (1) Fusha shtesë te mmti_state për aktivizimin e ardhshëm (të ndarë nga roboti aktual):
ALTER TABLE public.mmti_state
  ADD COLUMN IF NOT EXISTS live_enabled    boolean DEFAULT false,  -- ende false; edhe true s'ekzekuton te skeleti
  ADD COLUMN IF NOT EXISTS mmti_account_id text    DEFAULT '',     -- llogaria E NDARË e MMTI (jo ajo e robotit)
  ADD COLUMN IF NOT EXISTS mmti_token      text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS mmti_region     text    DEFAULT 'london';

-- (2) Regjistri i trade-ve SHADOW (virtuale): hapen nga sinjalet reale me TP-në e gjerë të MMTI-së
--     dhe ndiqen kundër çmimit aktual derisa prekin TP/SL ose skadojnë. pnl_r = rezultati në njësi rreziku.
CREATE TABLE IF NOT EXISTS public.mmti_shadow_trades (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id  uuid,                                  -- sinjali burim (dedup: një shadow-trade për sinjal)
  symbol     text,
  action     text,                                  -- BUY / SELL
  horizon    text,                                  -- short / long
  entry      numeric,
  sl         numeric,
  tp         numeric,                               -- TP-ja e gjerë e MMTI (entry ± slDist × recommendedR)
  rr         numeric,                               -- R:R i synuar
  status     text DEFAULT 'open',                   -- open / tp / sl / expired
  pnl_r      numeric,                               -- rezultati në R (win=+rr, sl=-1)
  created_at timestamptz DEFAULT now(),
  closed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS mmti_shadow_trades_status_idx ON public.mmti_shadow_trades(status);

ALTER TABLE public.mmti_shadow_trades ENABLE ROW LEVEL SECURITY;
-- Lexim për të identifikuarit (paneli i admin-it lexon performancën shadow). Shkrimi bëhet nga
-- edge function me service-role (anashkalon RLS), kështu që s'duhet politikë INSERT/UPDATE për klientët.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mmti_shadow_trades' AND policyname='mmti_shadow_read') THEN
    CREATE POLICY mmti_shadow_read ON public.mmti_shadow_trades FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
