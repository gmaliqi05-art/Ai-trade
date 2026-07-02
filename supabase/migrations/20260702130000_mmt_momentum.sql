-- MMT: strategjia MOMENTUM (BUY+SELL, kap shpërthimet) + parametrat e saj.
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS momentum_on boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS momentum_er numeric NOT NULL DEFAULT 0.65,
  ADD COLUMN IF NOT EXISTS momentum_atr numeric NOT NULL DEFAULT 1.0;
