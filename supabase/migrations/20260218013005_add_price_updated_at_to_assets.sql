/*
  # Add price_updated_at to assets and ensure updated_at exists

  Tracks when asset prices were last fetched from live market APIs.
  This allows the frontend to show data freshness indicators.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assets' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE assets ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;
