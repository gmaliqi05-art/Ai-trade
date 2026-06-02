/*
  # get_admin_stats: shifra reale për Admin Overview

  Zgjeron funksionin SECURITY DEFINER që të kthejë statistika reale (balancë totale,
  tregti, vëllim, sinjale aktive, aktive, analiza AI, përdorues me auto-trade) dhe
  8 tregtitë e fundit me emër përdoruesi + simbol. I aksesueshëm vetëm nga admin.
  Kjo heq nevojën për query direkte (që RLS i bllokon) dhe shifrat e trilluara në UI.
*/

CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true) THEN
    json_build_object(
      'totalUsers',     (SELECT count(*) FROM profiles),
      'proUsers',       (SELECT count(*) FROM profiles WHERE subscription_tier <> 'free'),
      'freeUsers',      (SELECT count(*) FROM profiles WHERE subscription_tier = 'free'),
      'totalBalance',   (SELECT COALESCE(sum(balance), 0) FROM profiles),
      'totalTrades',    (SELECT count(*) FROM trades),
      'buyVolume',      (SELECT COALESCE(sum(total), 0) FROM trades WHERE type = 'buy'),
      'activeSignals',  (SELECT count(*) FROM signals WHERE status = 'active'),
      'totalAssets',    (SELECT count(*) FROM assets),
      'aiAnalyses',     (SELECT count(*) FROM ai_analyses),
      'autoTradeUsers', (SELECT count(*) FROM metaapi_config WHERE auto_trade = true),
      'recentTrades',   (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
          SELECT tr.id, tr.type, tr.total, tr.executed_at, a.symbol AS symbol, p.full_name AS full_name
          FROM trades tr
          LEFT JOIN assets a ON a.id = tr.asset_id
          LEFT JOIN profiles p ON p.id = tr.user_id
          ORDER BY tr.executed_at DESC NULLS LAST
          LIMIT 8
      ) t)
    )
  ELSE NULL END;
$$;

GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated;
