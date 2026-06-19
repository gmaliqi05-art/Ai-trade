-- ============================================================
-- MetaApi: cache i qëndrueshëm i emrave REALË të simboleve te brokeri (rregullon "Unknown symbol 4301").
-- Bug-u: kur /symbols dështonte kalimtar (llogaria pa sinkronizuar), tregtimi manual binte te emri i
-- papërpunuar (XAUUSD) që disa brokerë s'e njohin (e quajnë XAUUSD+ etj.) → urdhri refuzohej.
-- Zgjidhja: ruajmë emrin REAL të verifikuar dhe e ripërdorim (imun ndaj dështimeve të /symbols).
-- ============================================================
ALTER TABLE public.metaapi_config
  ADD COLUMN IF NOT EXISTS symbol_map jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Mbush menjëherë XAUUSD→emri REAL i brokerit nga historiku i ekzekutimeve (emri i fundit me prapashtesë
-- që u përdor me sukses), që rregullimi të vlejë menjëherë për llogaritë ekzistuese (jo vetëm nga thirrja
-- e ardhshme e suksesshme e /symbols).
WITH recent_gold AS (
  SELECT DISTINCT ON (te.user_id) te.user_id, te.symbol
  FROM public.trade_executions te
  WHERE te.symbol ILIKE 'XAU%' AND upper(te.symbol) <> 'XAUUSD'
  ORDER BY te.user_id, te.created_at DESC
)
UPDATE public.metaapi_config mc
SET symbol_map = COALESCE(mc.symbol_map, '{}'::jsonb) || jsonb_build_object('XAUUSD', rg.symbol)
FROM recent_gold rg
WHERE mc.user_id = rg.user_id;
