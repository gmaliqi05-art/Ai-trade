/*
  # Statistika reale për super-admin (v2)

  Rishkruan `get_admin_stats()` që të mos përdorë tabelën boshe `trades`, por të dhënat REALE:
  - Ekzekutimet nga `trade_executions` (MT5 real / auto-trade).
  - Shpenzimet e AI nga `ai_usage_log` (kosto + thirrje, muaji aktual).
  - Thirrjet e MetaApi nga `metaapi_usage_log` (muaji aktual).
  Të dhënat e abonimit (proUsers/freeUsers) mbeten nga `profiles.subscription_tier`.
*/

CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true) THEN
    json_build_object(
      'totalUsers',      (SELECT count(*) FROM profiles),
      'proUsers',        (SELECT count(*) FROM profiles WHERE subscription_tier <> 'free'),
      'freeUsers',       (SELECT count(*) FROM profiles WHERE subscription_tier = 'free'),
      'totalBalance',    (SELECT COALESCE(sum(balance), 0) FROM profiles),
      'executions',      (SELECT count(*) FROM trade_executions WHERE status = 'executed'),
      'executionsToday', (SELECT count(*) FROM trade_executions WHERE status = 'executed' AND created_at >= date_trunc('day', now())),
      'activeSignals',   (SELECT count(*) FROM signals WHERE status = 'active'),
      'totalAssets',     (SELECT count(*) FROM assets),
      'autoTradeUsers',  (SELECT count(*) FROM metaapi_config WHERE auto_trade = true),
      'aiCostMonth',     (SELECT COALESCE(sum(cost_usd), 0) FROM ai_usage_log WHERE created_at >= date_trunc('month', now())),
      'aiCallsMonth',    (SELECT count(*) FROM ai_usage_log WHERE created_at >= date_trunc('month', now())),
      'metaCallsMonth',  (SELECT count(*) FROM metaapi_usage_log WHERE created_at >= date_trunc('month', now())),
      'recentTrades',    (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
          SELECT te.id, lower(te.action) AS type, te.symbol AS symbol, te.volume AS volume,
                 te.status AS status, te.created_at AS executed_at, p.full_name AS full_name
          FROM trade_executions te
          LEFT JOIN profiles p ON p.id = te.user_id
          ORDER BY te.created_at DESC NULLS LAST
          LIMIT 8
      ) t)
    )
  ELSE NULL END;
$$;
