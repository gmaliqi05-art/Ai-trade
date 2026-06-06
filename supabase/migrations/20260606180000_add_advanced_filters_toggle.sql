-- Tik opt-in per-përdorues për filtrat e avancuar (Tier-1: Efficiency Ratio + Supertrend + Funding).
-- Default false → motori përdor logjikën e thjeshtë të provuar (Multi-TF + EMA200 + ADX +
-- volatilitet + trend ditor + confluence). ON → shtohen filtrat Tier-1 për simbolet e atij përdoruesi.
ALTER TABLE metaapi_config
  ADD COLUMN IF NOT EXISTS advanced_filters boolean NOT NULL DEFAULT false;
