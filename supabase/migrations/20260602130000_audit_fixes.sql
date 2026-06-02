/*
  # Audit fixes: privatësi sinjalesh, anti-dyfishim, siguri, indekse

  #3 Privatësi: sinjalet personale (me user_id) të mos shihen nga përdorues të tjerë;
      platform-wide (user_id IS NULL) dhe admin-i shohin gjithçka.
  #2 Anti-dyfishim: një ekzekutim i suksesshëm për (user_id, signal_id).
  #5 Siguri: hiq EXECUTE publik nga handle_new_user (s'duhet RPC publik).
  Perf: indekse për query-t e nxehta (runner + dedup).
*/

-- #3 — RLS i ri për SELECT te signals
DROP POLICY IF EXISTS "Authenticated users can read signals" ON signals;
CREATE POLICY "Read own, platform-wide, or admin signals"
  ON signals FOR SELECT TO authenticated
  USING (
    user_id IS NULL
    OR user_id = auth.uid()
    OR (SELECT p.is_admin FROM profiles p WHERE p.id = auth.uid())
  );

-- #2 — një ekzekutim i suksesshëm për sinjal/përdorues
CREATE UNIQUE INDEX IF NOT EXISTS trade_executions_unique_executed
  ON trade_executions (user_id, signal_id)
  WHERE status = 'executed' AND signal_id IS NOT NULL;

-- Perf — dedup-i i runner-it (çdo status) + query-t
CREATE INDEX IF NOT EXISTS trade_executions_user_signal_idx ON trade_executions (user_id, signal_id);
CREATE INDEX IF NOT EXISTS signals_user_status_created_idx ON signals (user_id, status, created_at DESC);

-- #5 — handle_new_user s'duhet të jetë i thirrshëm si RPC publik (trigger-i punon gjithsesi)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
