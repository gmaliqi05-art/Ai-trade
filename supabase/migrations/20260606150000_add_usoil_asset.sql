-- Shton naftën (Crude Oil WTI, simbol USOIL) te tabela assets që të shfaqet te
-- "Tregto Live". Burimi i qirinjve në motor: Twelve Data (primar) + MetaApi (rezervë).
INSERT INTO assets (symbol, name, type, base_currency, quote_currency, current_price, is_active)
VALUES ('USOIL', 'Crude Oil WTI / US Dollar', 'commodity', 'WTI', 'USD', 65.00, true)
ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, is_active = true;
