/*
  # Fix RLS Policies for All Tables

  This migration adds comprehensive RLS policies for every table so the
  application works correctly for authenticated users.

  Tables covered:
  - profiles: users can read/update their own profile
  - assets: all authenticated users can read (public market data)
  - portfolio_positions: users can read/insert/update/delete their own positions
  - trades: users can read/insert their own trades
  - signals: all authenticated users can read (public signals)
  - alerts: users can manage their own alerts
  - watchlist: users can manage their own watchlist
  - ai_analyses: users can read/insert their own analyses
*/

-- =====================
-- PROFILES
-- =====================
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- =====================
-- ASSETS (public read for all authenticated users)
-- =====================
DROP POLICY IF EXISTS "Authenticated users can read assets" ON assets;

CREATE POLICY "Authenticated users can read assets"
  ON assets FOR SELECT
  TO authenticated
  USING (true);

-- =====================
-- SIGNALS (public read for all authenticated users)
-- =====================
DROP POLICY IF EXISTS "Authenticated users can read signals" ON signals;

CREATE POLICY "Authenticated users can read signals"
  ON signals FOR SELECT
  TO authenticated
  USING (true);

-- =====================
-- PORTFOLIO_POSITIONS
-- =====================
DROP POLICY IF EXISTS "Users can read own positions" ON portfolio_positions;
DROP POLICY IF EXISTS "Users can insert own positions" ON portfolio_positions;
DROP POLICY IF EXISTS "Users can update own positions" ON portfolio_positions;
DROP POLICY IF EXISTS "Users can delete own positions" ON portfolio_positions;

CREATE POLICY "Users can read own positions"
  ON portfolio_positions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own positions"
  ON portfolio_positions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own positions"
  ON portfolio_positions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own positions"
  ON portfolio_positions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================
-- TRADES
-- =====================
DROP POLICY IF EXISTS "Users can read own trades" ON trades;
DROP POLICY IF EXISTS "Users can insert own trades" ON trades;

CREATE POLICY "Users can read own trades"
  ON trades FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trades"
  ON trades FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- =====================
-- ALERTS
-- =====================
DROP POLICY IF EXISTS "Users can read own alerts" ON alerts;
DROP POLICY IF EXISTS "Users can insert own alerts" ON alerts;
DROP POLICY IF EXISTS "Users can update own alerts" ON alerts;
DROP POLICY IF EXISTS "Users can delete own alerts" ON alerts;

CREATE POLICY "Users can read own alerts"
  ON alerts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own alerts"
  ON alerts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own alerts"
  ON alerts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own alerts"
  ON alerts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================
-- WATCHLIST
-- =====================
DROP POLICY IF EXISTS "Users can read own watchlist" ON watchlist;
DROP POLICY IF EXISTS "Users can insert own watchlist" ON watchlist;
DROP POLICY IF EXISTS "Users can delete own watchlist" ON watchlist;

CREATE POLICY "Users can read own watchlist"
  ON watchlist FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watchlist"
  ON watchlist FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own watchlist"
  ON watchlist FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================
-- AI_ANALYSES
-- =====================
DROP POLICY IF EXISTS "Users can read own analyses" ON ai_analyses;
DROP POLICY IF EXISTS "Users can insert own analyses" ON ai_analyses;

CREATE POLICY "Users can read own analyses"
  ON ai_analyses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
  ON ai_analyses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
