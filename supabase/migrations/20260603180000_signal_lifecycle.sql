-- Cikli jetësor i sinjalit: kur arrin TP/SL ose skadon, shënohet dhe del nga aktivet.
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome text,        -- 'tp' | 'sl' | 'expired'
  ADD COLUMN IF NOT EXISTS result_pct numeric;  -- % i lëvizjes nëse ndiqej sinjali (+ sukses, - humbje)

CREATE INDEX IF NOT EXISTS idx_signals_outcome ON signals (outcome, closed_at DESC);
