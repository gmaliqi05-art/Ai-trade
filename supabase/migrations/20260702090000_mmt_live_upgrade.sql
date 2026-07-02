-- MMT LIVE: aftësia e ekzekutimit real (çelësi në dorën e pronarit, default OFF)
-- + mbrojtjet e reja para-hyrjes (spike, presion blerës/shitës, zona rreziku, ri-skanimi i çastit).
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS live_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_lots numeric NOT NULL DEFAULT 0.01,
  ADD COLUMN IF NOT EXISTS live_user_id uuid,
  ADD COLUMN IF NOT EXISTS spike_mult numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS zone_atr numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS pressure_pct numeric NOT NULL DEFAULT 65;

ALTER TABLE public.mmt_trades
  ADD COLUMN IF NOT EXISTS live boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_order_id text;
