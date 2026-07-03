-- MMT-Fast i PAVARUR: kufij vetëm të tijët (nuk e ngrijnë humbjet e Long/Scalp,
-- as sesionet, as blackout-i, as kill-switch-i i përbashkët).
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS fast_kill_after_sl integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS fast_daily_stop_usd numeric NOT NULL DEFAULT 12;
