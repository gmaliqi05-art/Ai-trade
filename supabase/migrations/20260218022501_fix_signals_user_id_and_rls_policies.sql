/*
  # Fix signals table and RLS policies for AI-generated signals

  ## Problems Found
  1. signals table has no user_id column - ai-analyze function fails when inserting signals
  2. signals INSERT policy only allows admins - AI edge function (service role) needs to insert
  3. ai_analyses INSERT policy has no WITH CHECK clause
  4. chart_analyses INSERT policy has no WITH CHECK clause

  ## Fixes
  1. Add user_id column to signals (nullable for platform-wide signals)
  2. Drop restrictive admin-only INSERT policy on signals
  3. Allow service role (edge functions) to insert signals
  4. Allow authenticated users to insert their own signals
  5. Fix ai_analyses and chart_analyses INSERT policies
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'signals' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE signals ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP POLICY IF EXISTS "Admins can insert signals" ON signals;

CREATE POLICY "Service role can insert signals"
  ON signals FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert own signals"
  ON signals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert own analyses" ON ai_analyses;

CREATE POLICY "Users can insert own analyses"
  ON ai_analyses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can insert ai analyses"
  ON ai_analyses FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can insert own chart analyses" ON chart_analyses;

CREATE POLICY "Users can insert own chart analyses"
  ON chart_analyses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can insert chart analyses"
  ON chart_analyses FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update chart analyses"
  ON chart_analyses FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can read ai providers"
  ON ai_providers FOR SELECT
  TO service_role
  USING (true);
