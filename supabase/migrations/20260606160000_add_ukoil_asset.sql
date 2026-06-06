-- Shton naftën Brent (simbol UKOIL) te tabela assets që të shfaqet te "Tregto Live".
-- Burimi i qirinjve në motor: Twelve Data (BRENT/USD, primar) + MetaApi (rezervë).
INSERT INTO assets (symbol, name, type, base_currency, quote_currency, current_price, is_active)
VALUES ('UKOIL', 'Crude Oil Brent / US Dollar', 'commodity', 'BRENT', 'USD', 70.00, true)
ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, is_active = true;
