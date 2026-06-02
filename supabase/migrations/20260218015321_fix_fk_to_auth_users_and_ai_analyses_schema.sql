/*
  # Fix Foreign Keys and AI Analyses Schema

  ## Problems Fixed:
  1. chart_analyses.user_id was referencing profiles(id) — but profiles may not exist yet
     when a new user first runs analysis. Changed to reference auth.users(id).
  2. ai_analyses.user_id same issue — changed to reference auth.users(id).
  3. ai_analyses table had wrong columns (missing analysis_text, prediction that the
     edge function tries to insert). Added missing columns.

  ## Changes:
  - Drop and recreate FK on chart_analyses.user_id → auth.users(id)
  - Drop and recreate FK on ai_analyses.user_id → auth.users(id)
  - Add analysis_text and prediction columns to ai_analyses if missing
  - Ensure RLS policies still work correctly
*/

-- Fix chart_analyses FK
ALTER TABLE chart_analyses DROP CONSTRAINT IF EXISTS chart_analyses_user_id_fkey;
ALTER TABLE chart_analyses
  ADD CONSTRAINT chart_analyses_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Fix ai_analyses FK
ALTER TABLE ai_analyses DROP CONSTRAINT IF EXISTS ai_analyses_user_id_fkey;
ALTER TABLE ai_analyses
  ADD CONSTRAINT ai_analyses_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add missing columns to ai_analyses that the edge function tries to insert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_analyses' AND column_name = 'analysis_text'
  ) THEN
    ALTER TABLE ai_analyses ADD COLUMN analysis_text text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_analyses' AND column_name = 'prediction'
  ) THEN
    ALTER TABLE ai_analyses ADD COLUMN prediction text;
  END IF;
END $$;

-- Ensure RLS is still enabled
ALTER TABLE chart_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analyses ENABLE ROW LEVEL SECURITY;
