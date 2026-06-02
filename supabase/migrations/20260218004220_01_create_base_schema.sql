/*
  # Base Schema - All core tables for the Gold Trading Platform

  Creates the complete base schema including:
  - profiles, assets, portfolio_positions, trades, signals, alerts, watchlist, ai_analyses
  - is_admin column on profiles
  - admin_audit_log
  - subscription_plans, subscriptions
  - ai_providers
  - metatrader_connections, mt_market_data
  - chart_analyses
  - push_tokens, notifications, reports
  - All RLS policies
*/

-- =====================
-- PROFILES
-- =====================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  username text UNIQUE,
  avatar_url text,
  balance numeric(20,2) NOT NULL DEFAULT 0,
  subscription_tier text NOT NULL DEFAULT 'free',
  is_admin boolean NOT NULL DEFAULT false,
  notification_preferences jsonb DEFAULT '{"signals": true, "priceAlerts": true, "newsletter": false, "tradeConfirmations": true}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_admin = true));

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_admin = true))
  WITH CHECK (id = auth.uid() OR EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_admin = true));

-- =====================
-- ASSETS
-- =====================
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text UNIQUE NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'forex',
  base_currency text DEFAULT '',
  quote_currency text DEFAULT '',
  current_price numeric(20,8),
  price_change_24h numeric(10,4),
  price_change_pct_24h numeric(10,4),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read assets"
  ON assets FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert assets"
  ON assets FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE POLICY "Admins can update assets"
  ON assets FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE POLICY "Admins can delete assets"
  ON assets FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- Seed assets
INSERT INTO assets (symbol, name, type, base_currency, quote_currency, current_price, price_change_24h, price_change_pct_24h) VALUES
  ('XAUUSD', 'Gold / US Dollar', 'commodity', 'XAU', 'USD', 2345.50, 12.30, 0.53),
  ('EURUSD', 'Euro / US Dollar', 'forex', 'EUR', 'USD', 1.0856, 0.0012, 0.11),
  ('GBPUSD', 'British Pound / US Dollar', 'forex', 'GBP', 'USD', 1.2743, -0.0008, -0.06),
  ('USDJPY', 'US Dollar / Japanese Yen', 'forex', 'USD', 'JPY', 149.82, 0.45, 0.30),
  ('XAGUSD', 'Silver / US Dollar', 'commodity', 'XAG', 'USD', 27.45, 0.32, 1.18),
  ('BTCUSD', 'Bitcoin / US Dollar', 'crypto', 'BTC', 'USD', 67234.00, 1234.00, 1.87)
ON CONFLICT (symbol) DO NOTHING;

-- =====================
-- PORTFOLIO POSITIONS
-- =====================
CREATE TABLE IF NOT EXISTS portfolio_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  asset_id uuid REFERENCES assets(id),
  symbol text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'long',
  quantity numeric(20,8) NOT NULL DEFAULT 0,
  entry_price numeric(20,8) NOT NULL DEFAULT 0,
  current_price numeric(20,8),
  stop_loss numeric(20,8),
  take_profit numeric(20,8),
  leverage integer NOT NULL DEFAULT 1,
  margin numeric(20,2),
  unrealized_pnl numeric(20,2),
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own positions"
  ON portfolio_positions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own positions"
  ON portfolio_positions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own positions"
  ON portfolio_positions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own positions"
  ON portfolio_positions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =====================
-- TRADES
-- =====================
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  asset_id uuid REFERENCES assets(id),
  symbol text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'buy',
  quantity numeric(20,8) NOT NULL DEFAULT 0,
  price numeric(20,8) NOT NULL DEFAULT 0,
  total numeric(20,2),
  fee numeric(20,2) DEFAULT 0,
  pnl numeric(20,2),
  status text NOT NULL DEFAULT 'filled',
  executed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own trades"
  ON trades FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trades"
  ON trades FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- =====================
-- SIGNALS
-- =====================
CREATE TABLE IF NOT EXISTS signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES assets(id),
  symbol text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'buy',
  entry_price numeric(20,8),
  target_price numeric(20,8),
  stop_loss numeric(20,8),
  confidence numeric(5,2),
  timeframe text DEFAULT '1H',
  analysis text,
  status text NOT NULL DEFAULT 'active',
  source text DEFAULT 'ai',
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read signals"
  ON signals FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert signals"
  ON signals FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE POLICY "Admins can update signals"
  ON signals FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE POLICY "Admins can delete signals"
  ON signals FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- =====================
-- ALERTS
-- =====================
CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  asset_id uuid REFERENCES assets(id),
  symbol text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'price_above',
  target_value numeric(20,8) NOT NULL DEFAULT 0,
  message text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  triggered_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own alerts"
  ON alerts FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own alerts"
  ON alerts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own alerts"
  ON alerts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own alerts"
  ON alerts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =====================
-- WATCHLIST
-- =====================
CREATE TABLE IF NOT EXISTS watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  asset_id uuid REFERENCES assets(id),
  symbol text NOT NULL DEFAULT '',
  added_at timestamptz DEFAULT now(),
  UNIQUE(user_id, symbol)
);

ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own watchlist"
  ON watchlist FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watchlist"
  ON watchlist FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own watchlist"
  ON watchlist FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =====================
-- AI ANALYSES (legacy)
-- =====================
CREATE TABLE IF NOT EXISTS ai_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  asset_id uuid REFERENCES assets(id),
  symbol text NOT NULL DEFAULT '',
  timeframe text DEFAULT '1H',
  signal text,
  confidence numeric(5,2),
  entry_price numeric(20,8),
  target_price numeric(20,8),
  stop_loss numeric(20,8),
  analysis text,
  sentiment text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own analyses"
  ON ai_analyses FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
  ON ai_analyses FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- =====================
-- ADMIN AUDIT LOG
-- =====================
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES profiles(id),
  action text NOT NULL DEFAULT '',
  target_table text NOT NULL DEFAULT '',
  target_id text,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit log"
  ON admin_audit_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE POLICY "Admins can insert audit log"
  ON admin_audit_log FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = admin_id AND
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );

-- =====================
-- SUBSCRIPTION PLANS
-- =====================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  slug text UNIQUE NOT NULL DEFAULT '',
  price_monthly numeric(10,2) NOT NULL DEFAULT 0,
  max_analyses_per_month integer NOT NULL DEFAULT 0,
  max_signals_per_month integer NOT NULL DEFAULT 0,
  max_alerts integer NOT NULL DEFAULT 0,
  has_metatrader boolean NOT NULL DEFAULT false,
  has_reports boolean NOT NULL DEFAULT false,
  has_ai_analysis boolean NOT NULL DEFAULT false,
  features jsonb DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read plans"
  ON subscription_plans FOR SELECT TO authenticated USING (true);

INSERT INTO subscription_plans (name, slug, price_monthly, max_analyses_per_month, max_signals_per_month, max_alerts, has_metatrader, has_reports, has_ai_analysis, features)
VALUES
  ('Free', 'free', 0.00, 5, 10, 3, false, false, false, '["5 AI analyses/month","10 signals/month","3 price alerts","Basic dashboard"]'::jsonb),
  ('Standard', 'standard', 29.00, 30, 100, 20, true, false, true, '["30 AI analyses/month","Unlimited signals","20 price alerts","MetaTrader integration","AI Vision analysis"]'::jsonb),
  ('Premium', 'premium', 79.00, -1, -1, -1, true, true, true, '["Unlimited AI analyses","Unlimited signals","Unlimited alerts","MetaTrader integration","AI Vision analysis","PDF/CSV reports","Priority support","Dedicated advisor"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- =====================
-- SUBSCRIPTIONS
-- =====================
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  plan_id uuid REFERENCES subscription_plans(id),
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  auto_renew boolean NOT NULL DEFAULT true,
  stripe_subscription_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription"
  ON subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscription"
  ON subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscription"
  ON subscriptions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =====================
-- AI PROVIDERS
-- =====================
CREATE TABLE IF NOT EXISTS ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  slug text UNIQUE NOT NULL DEFAULT '',
  api_key_encrypted text,
  model text NOT NULL DEFAULT '',
  endpoint text,
  system_prompt text DEFAULT '',
  is_active boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage AI providers"
  ON ai_providers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE POLICY "Authenticated users can read active providers"
  ON ai_providers FOR SELECT TO authenticated USING (is_active = true);

INSERT INTO ai_providers (name, slug, model, endpoint, is_active, is_default, priority, system_prompt)
VALUES
  ('OpenAI GPT-4 Vision', 'openai', 'gpt-4o', 'https://api.openai.com/v1/chat/completions', false, true, 1,
   'You are an expert gold (XAU/USD) and forex technical analyst with 20 years of experience. Analyze the provided chart image and return a JSON response with: signal (BUY/SELL/HOLD), confidence (0-100), entry_price, target_price, stop_loss, timeframe, reasoning (detailed analysis).'),
  ('Anthropic Claude Vision', 'anthropic', 'claude-3-5-sonnet-20241022', 'https://api.anthropic.com/v1/messages', false, false, 2,
   'You are an expert gold (XAU/USD) and forex technical analyst. Analyze the chart image and return JSON: signal (BUY/SELL/HOLD), confidence (0-100), entry_price, target_price, stop_loss, timeframe, reasoning.'),
  ('Google Gemini Vision', 'gemini', 'gemini-1.5-flash', 'https://generativelanguage.googleapis.com/v1beta/models', false, false, 3,
   'Expert forex and gold technical analyst. Analyze the chart image and return JSON: signal (BUY/SELL/HOLD), confidence (0-100), entry_price, target_price, stop_loss, timeframe, reasoning.')
ON CONFLICT (slug) DO NOTHING;

-- =====================
-- METATRADER CONNECTIONS
-- =====================
CREATE TABLE IF NOT EXISTS metatrader_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  platform text NOT NULL DEFAULT 'MT4',
  server text NOT NULL DEFAULT '',
  login text NOT NULL DEFAULT '',
  investor_password_encrypted text,
  symbol text NOT NULL DEFAULT 'XAUUSD',
  interval_minutes integer NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT false,
  last_ping_at timestamptz,
  last_data_at timestamptz,
  api_key text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE metatrader_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own MT connections"
  ON metatrader_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own MT connections"
  ON metatrader_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own MT connections"
  ON metatrader_connections FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own MT connections"
  ON metatrader_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =====================
-- MT MARKET DATA
-- =====================
CREATE TABLE IF NOT EXISTS mt_market_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES metatrader_connections(id),
  user_id uuid NOT NULL REFERENCES profiles(id),
  symbol text NOT NULL DEFAULT '',
  timeframe text NOT NULL DEFAULT '',
  open_price numeric(20,8),
  high_price numeric(20,8),
  low_price numeric(20,8),
  close_price numeric(20,8),
  volume numeric(20,2),
  bar_time timestamptz,
  indicators jsonb DEFAULT '{}'::jsonb,
  chart_image_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE mt_market_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own MT data"
  ON mt_market_data FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own MT data"
  ON mt_market_data FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- =====================
-- CHART ANALYSES
-- =====================
CREATE TABLE IF NOT EXISTS chart_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  asset_id uuid REFERENCES assets(id),
  source text NOT NULL DEFAULT 'manual',
  ai_provider text NOT NULL DEFAULT 'openai',
  chart_image_url text,
  chart_type text DEFAULT 'candlestick',
  timeframe text DEFAULT '1H',
  signal text,
  confidence numeric(5,2),
  entry_price numeric(20,8),
  target_price numeric(20,8),
  stop_loss numeric(20,8),
  analysis_text text,
  reasoning text,
  raw_response jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE chart_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own chart analyses"
  ON chart_analyses FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chart analyses"
  ON chart_analyses FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chart analyses"
  ON chart_analyses FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =====================
-- PUSH TOKENS
-- =====================
CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  token text NOT NULL DEFAULT '',
  platform text NOT NULL DEFAULT 'web',
  device_info jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, token)
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own push tokens"
  ON push_tokens FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push tokens"
  ON push_tokens FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push tokens"
  ON push_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own push tokens"
  ON push_tokens FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =====================
-- NOTIFICATIONS
-- =====================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id),
  type text NOT NULL DEFAULT 'info',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  data jsonb DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  sent_push boolean NOT NULL DEFAULT false,
  sent_email boolean NOT NULL DEFAULT false,
  is_broadcast boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR is_broadcast = true);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert notifications"
  ON notifications FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );

-- =====================
-- REPORTS
-- =====================
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  title text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'performance',
  period_start timestamptz,
  period_end timestamptz,
  data jsonb DEFAULT '{}'::jsonb,
  file_url text,
  format text NOT NULL DEFAULT 'pdf',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own reports"
  ON reports FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reports"
  ON reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
