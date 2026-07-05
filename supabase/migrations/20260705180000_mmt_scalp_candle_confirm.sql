-- MMT-Scalp: konfirmim opsional me figurë qiriu (Engulfing/Morning-Evening Star/
-- Hammer-Shooting Star). Default OFF — figura MATET gjithmonë (etiketohet te
-- reason), por e bllokon hyrjen vetëm kur pronari e ndez, pas provës A/B.
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS scalp_candle_confirm boolean NOT NULL DEFAULT false;
