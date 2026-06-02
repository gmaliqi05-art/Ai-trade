/*
  # Auto-execute mbi sinjale: fusha sigurie shtesë

  Shton te `metaapi_config`:
  - `min_confidence` — vetëm sinjalet me besueshmëri >= këtij pragu ekzekutohen automatikisht.
  - `auto_symbols`   — lista (e ndarë me presje) e simboleve që lejohen për auto-trade.
    Default 'XAUUSD' (ari) — që auto-trade të mos prekë simbole të paqëllimta.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'metaapi_config' AND column_name = 'min_confidence') THEN
    ALTER TABLE metaapi_config ADD COLUMN min_confidence integer NOT NULL DEFAULT 70;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'metaapi_config' AND column_name = 'auto_symbols') THEN
    ALTER TABLE metaapi_config ADD COLUMN auto_symbols text NOT NULL DEFAULT 'XAUUSD';
  END IF;
END $$;
