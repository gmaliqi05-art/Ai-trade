
/*
  # Add missing columns to assets and fix alerts table

  1. Changes to `assets` table
    - Add `category` column (mirrors `type`) for backwards compatibility with frontend
    - Add `price_change_pct` column (mirrors `price_change_pct_24h`)
    - Add `volume_24h`, `high_24h`, `low_24h` columns used by admin/trading pages

  2. Changes to `alerts` table
    - Add `condition` column (mirrors `type`) for frontend compatibility
    - Add `target_price` column (mirrors `target_value`) for frontend compatibility

  3. Changes to `signals` table
    - Add `asset_id` foreign key column so join with assets works
*/

-- Add category alias column to assets
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'category') THEN
    ALTER TABLE assets ADD COLUMN category text GENERATED ALWAYS AS (type) STORED;
  END IF;
END $$;

-- Add price_change_pct alias to assets
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'price_change_pct') THEN
    ALTER TABLE assets ADD COLUMN price_change_pct numeric GENERATED ALWAYS AS (price_change_pct_24h) STORED;
  END IF;
END $$;

-- Add volume_24h to assets
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'volume_24h') THEN
    ALTER TABLE assets ADD COLUMN volume_24h numeric DEFAULT 0;
  END IF;
END $$;

-- Add high_24h to assets
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'high_24h') THEN
    ALTER TABLE assets ADD COLUMN high_24h numeric DEFAULT 0;
  END IF;
END $$;

-- Add low_24h to assets
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'low_24h') THEN
    ALTER TABLE assets ADD COLUMN low_24h numeric DEFAULT 0;
  END IF;
END $$;

-- Add market_cap to assets
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'market_cap') THEN
    ALTER TABLE assets ADD COLUMN market_cap numeric DEFAULT 0;
  END IF;
END $$;

-- Add condition alias to alerts
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alerts' AND column_name = 'condition') THEN
    ALTER TABLE alerts ADD COLUMN condition text DEFAULT 'above';
  END IF;
END $$;

-- Add target_price alias to alerts
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alerts' AND column_name = 'target_price') THEN
    ALTER TABLE alerts ADD COLUMN target_price numeric DEFAULT 0;
  END IF;
END $$;

-- Add asset_id to signals if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'signals' AND column_name = 'asset_id') THEN
    ALTER TABLE signals ADD COLUMN asset_id uuid REFERENCES assets(id) ON DELETE SET NULL;
  END IF;
END $$;
