-- FAZA 2 (truri vetë-mësues): ruaj "pikat kyçe" (snapshot i indikatorëve + konteksti)
-- në momentin që gjenerohet çdo sinjal. Bashkë me rezultatin (status/outcome/result_pct),
-- kjo krijon datasetin e etiketuar: kushtet → fitim/humbje, për analizë & optimizim.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS features jsonb;
CREATE INDEX IF NOT EXISTS idx_signals_features_gin ON signals USING gin (features);
