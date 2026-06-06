-- FOKUS: vetëm Ar (XAUUSD) + Naftë (USOIL, UKOIL). Heqja e crypto-s dhe e gjithçkaje
-- tjetër që roboti + AI të jenë më të fokusuar/profesionalë te dy aktive të lidhura (mall, USD).

-- Çaktivizo gjithçka tjetër (crypto, forex, aksione, argjend) që të mos shfaqen e të mos tregtohen.
UPDATE assets SET is_active = false
  WHERE upper(symbol) NOT IN ('XAUUSD', 'USOIL', 'UKOIL');

-- Pastro auto_symbols e konfigurimeve ekzistuese: hiq çdo simbol jo ar/naftë;
-- nëse mbetet bosh, kthe te ari si default.
UPDATE metaapi_config SET auto_symbols = COALESCE((
  SELECT string_agg(tok, ',')
  FROM (SELECT trim(x) AS tok FROM unnest(string_to_array(auto_symbols, ',')) AS x) q
  WHERE upper(tok) IN ('XAUUSD', 'USOIL', 'UKOIL')
), 'XAUUSD')
WHERE auto_symbols IS NOT NULL;
