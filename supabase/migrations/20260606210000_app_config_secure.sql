-- Tabelë konfigurimi e sigurt për çelësa API server-side (p.sh. Twelve Data).
-- RLS e ndezur PA asnjë politikë publike → vetëm service_role (funksionet edge) e lexon.
-- Përdoruesit/anon NUK kanë qasje. Vlerat (sekretet) vendosen live, JO në repo.
CREATE TABLE IF NOT EXISTS app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
-- Asnjë policy → mohim i plotë për anon/authenticated; service_role e anashkalon RLS.

-- Shënim: çelësi 'twelvedata_api_key' vendoset live (jo në repo, që mos të dalë në git).
