/*
  # Përdorimi i planit për përdoruesin aktual (matës "X nga Y")

  RPC `get_my_usage()` kthen planin e përdoruesit + sa ka përdorur këtë muaj nga limitet
  (analiza AI, alarme). -1 = pa limit. Përdoret nga matësi në klient.
  Varet nga `ai_usage_log` (migrimi i usage_tracking) + `subscription_plans`.
*/

CREATE OR REPLACE FUNCTION get_my_usage()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  tier text;
  ai_limit int;
  alerts_limit int;
  ai_used int;
  alerts_used int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT COALESCE(subscription_tier, 'free') INTO tier FROM profiles WHERE id = uid;
  SELECT max_analyses_per_month, max_alerts INTO ai_limit, alerts_limit
    FROM subscription_plans WHERE slug = COALESCE(tier, 'free') LIMIT 1;
  SELECT count(*) INTO ai_used FROM ai_usage_log
    WHERE user_id = uid AND created_at >= date_trunc('month', now());
  SELECT count(*) INTO alerts_used FROM alerts WHERE user_id = uid;
  RETURN jsonb_build_object(
    'plan', COALESCE(tier, 'free'),
    'ai_used', COALESCE(ai_used, 0),
    'ai_limit', COALESCE(ai_limit, -1),
    'alerts_used', COALESCE(alerts_used, 0),
    'alerts_limit', COALESCE(alerts_limit, -1)
  );
END; $$;

REVOKE EXECUTE ON FUNCTION get_my_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_my_usage() TO authenticated;
