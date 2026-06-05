/*
  # Ndjekja e përdorimit & kostove (AI/Claude + MetaApi)

  Tabela për të regjistruar sa tokena/kosto shpenzon platforma nga ofruesit e AI
  (Claude/OpenAI/Gemini) dhe sa thirrje bën te MetaApi. Përdoret nga paneli i admin-it.

  1. Tabela të reja
     - `ai_usage_log`      — një rresht për çdo thirrje AI (tokena hyrje/dalje, kosto USD).
     - `metaapi_usage_log` — një rresht për çdo thirrje te MetaApi (veprimi, kosto e përafërt).
  2. Siguria (RLS)
     - Vetëm adminët (profiles.is_admin) mund të LEXOJNË.
     - Shkrimi bëhet nga edge functions me service_role (e anashkalon RLS).
*/

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text,
  prompt_tokens integer DEFAULT 0,
  completion_tokens integer DEFAULT 0,
  total_tokens integer DEFAULT 0,
  cost_usd numeric(12,6) DEFAULT 0,
  kind text DEFAULT 'analysis',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_log (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage_log (provider);

CREATE TABLE IF NOT EXISTS metaapi_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  symbol text,
  cost_usd numeric(12,6) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_usage_created ON metaapi_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_usage_user ON metaapi_usage_log (user_id);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE metaapi_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read ai usage" ON ai_usage_log;
CREATE POLICY "admins read ai usage" ON ai_usage_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

DROP POLICY IF EXISTS "admins read meta usage" ON metaapi_usage_log;
CREATE POLICY "admins read meta usage" ON metaapi_usage_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

-- Agregim server-side (SUM/COUNT) për panelin e admin-it — i shkallëzueshëm edhe me shumë rreshta.
CREATE OR REPLACE FUNCTION get_usage_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_adm boolean;
  ms timestamptz := date_trunc('month', now());
  ds timestamptz := date_trunc('day', now());
  res jsonb;
BEGIN
  SELECT p.is_admin INTO is_adm FROM profiles p WHERE p.id = auth.uid();
  IF NOT COALESCE(is_adm, false) THEN RAISE EXCEPTION 'not authorized'; END IF;
  res := jsonb_build_object(
    'ai_cost_month',   COALESCE((SELECT SUM(cost_usd)     FROM ai_usage_log      WHERE created_at >= ms), 0),
    'ai_tokens_month', COALESCE((SELECT SUM(total_tokens) FROM ai_usage_log      WHERE created_at >= ms), 0),
    'ai_calls_month',  COALESCE((SELECT COUNT(*)          FROM ai_usage_log      WHERE created_at >= ms), 0),
    'ai_cost_today',   COALESCE((SELECT SUM(cost_usd)     FROM ai_usage_log      WHERE created_at >= ds), 0),
    'ai_calls_today',  COALESCE((SELECT COUNT(*)          FROM ai_usage_log      WHERE created_at >= ds), 0),
    'meta_calls_month',COALESCE((SELECT COUNT(*)          FROM metaapi_usage_log WHERE created_at >= ms), 0),
    'meta_cost_month', COALESCE((SELECT SUM(cost_usd)     FROM metaapi_usage_log WHERE created_at >= ms), 0),
    'meta_calls_today',COALESCE((SELECT COUNT(*)          FROM metaapi_usage_log WHERE created_at >= ds), 0),
    'ai_by_model', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT provider, model, COUNT(*) AS calls, SUM(total_tokens) AS tokens, SUM(cost_usd) AS cost
        FROM ai_usage_log WHERE created_at >= ms GROUP BY provider, model ORDER BY SUM(cost_usd) DESC LIMIT 50) x), '[]'::jsonb),
    'meta_by_action', COALESCE((SELECT jsonb_agg(y) FROM (
        SELECT action, COUNT(*) AS calls, SUM(cost_usd) AS cost
        FROM metaapi_usage_log WHERE created_at >= ms GROUP BY action ORDER BY COUNT(*) DESC LIMIT 50) y), '[]'::jsonb)
  );
  RETURN res;
END; $$;
GRANT EXECUTE ON FUNCTION get_usage_summary() TO authenticated;
