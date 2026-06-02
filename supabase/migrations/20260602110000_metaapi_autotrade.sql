/*
  # MetaApi auto-trade: konfigurimi + regjistri i ekzekutimeve

  Faza 5 — lidhja me MetaTrader 5 via MetaApi.cloud për auto-trade me mbrojtje rreziku.
  "Demo i pari": mode-i fillon gjithmonë 'demo' dhe auto_trade është i fikur deri sa
  përdoruesi ta aktivizojë me vetëdije.

  1. `metaapi_config` — një rresht për përdorues: token + account id + cilësimet e rrezikut.
  2. `trade_executions` — regjistër i çdo përpjekjeje për ekzekutim (audit + mbrojtje).
*/

CREATE TABLE IF NOT EXISTS metaapi_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id text NOT NULL DEFAULT '',
  token text NOT NULL DEFAULT '',
  region text NOT NULL DEFAULT 'new-york',
  mode text NOT NULL DEFAULT 'demo',          -- 'demo' | 'live'
  auto_trade boolean NOT NULL DEFAULT false,
  default_lot numeric NOT NULL DEFAULT 0.01,
  max_lot numeric NOT NULL DEFAULT 0.10,
  max_daily_loss numeric NOT NULL DEFAULT 100,
  max_open_trades integer NOT NULL DEFAULT 3,
  kill_switch boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE metaapi_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own metaapi config (select)"
  ON metaapi_config FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users manage own metaapi config (insert)"
  ON metaapi_config FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own metaapi config (update)"
  ON metaapi_config FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own metaapi config (delete)"
  ON metaapi_config FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS trade_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_id uuid,
  symbol text NOT NULL DEFAULT '',
  action text NOT NULL DEFAULT '',            -- 'BUY' | 'SELL'
  volume numeric NOT NULL DEFAULT 0,
  entry_price numeric,
  stop_loss numeric,
  take_profit numeric,
  mode text NOT NULL DEFAULT 'demo',
  status text NOT NULL DEFAULT 'pending',      -- 'executed' | 'rejected' | 'error'
  reason text,
  metaapi_order_id text,
  raw_response jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE trade_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own executions"
  ON trade_executions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own executions"
  ON trade_executions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role manages executions"
  ON trade_executions FOR ALL TO service_role USING (true) WITH CHECK (true);
