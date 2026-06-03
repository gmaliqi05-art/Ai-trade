-- Madhësia e pozicionit sipas besueshmërisë së sinjalit (dinamike).
-- Kur dynamic_lot = true, auto-trade-runner zgjedh lotin sipas % të analizës:
--   conf ≥ 70% → lot_conf_70 (default 0.01)
--   conf ≥ 80% → lot_conf_80 (default 0.02)
--   conf ≥ 90% → lot_conf_90 (default 0.05)
-- I kapur gjithmonë te max_lot. Kur dynamic_lot = false, përdoret default_lot.

ALTER TABLE metaapi_config
  ADD COLUMN IF NOT EXISTS dynamic_lot boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS lot_conf_70 numeric NOT NULL DEFAULT 0.01,
  ADD COLUMN IF NOT EXISTS lot_conf_80 numeric NOT NULL DEFAULT 0.02,
  ADD COLUMN IF NOT EXISTS lot_conf_90 numeric NOT NULL DEFAULT 0.05;
