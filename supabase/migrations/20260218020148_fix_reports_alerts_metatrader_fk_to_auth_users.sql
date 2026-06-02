/*
  # Fix remaining tables FK to auth.users

  reports, alerts, and metatrader_connections still reference profiles(id).
  Changed all to reference auth.users(id) to prevent insert failures.
*/

-- Fix reports FK
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_user_id_fkey;
ALTER TABLE reports
  ADD CONSTRAINT reports_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Fix alerts FK if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alerts_user_id_fkey'
    AND conrelid = 'alerts'::regclass
  ) THEN
    ALTER TABLE alerts DROP CONSTRAINT alerts_user_id_fkey;
    ALTER TABLE alerts
      ADD CONSTRAINT alerts_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Fix metatrader_connections FK if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'metatrader_connections_user_id_fkey'
    AND conrelid = 'metatrader_connections'::regclass
  ) THEN
    ALTER TABLE metatrader_connections DROP CONSTRAINT metatrader_connections_user_id_fkey;
    ALTER TABLE metatrader_connections
      ADD CONSTRAINT metatrader_connections_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
