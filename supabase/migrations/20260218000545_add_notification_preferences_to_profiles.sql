/*
  # Add notification_preferences column to profiles

  Adds a JSONB column to store user notification preferences.
  Default values are set so existing rows remain valid.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'notification_preferences'
  ) THEN
    ALTER TABLE profiles ADD COLUMN notification_preferences jsonb DEFAULT '{"signals": true, "priceAlerts": true, "newsletter": false, "tradeConfirmations": true}'::jsonb;
  END IF;
END $$;
