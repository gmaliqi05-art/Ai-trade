-- MMTI — Faza B: ruan planin e optimizuar (formula e nxjerrë nga trade-t reale).
-- Vetëm kolona shtesë te mmti_state; pa prekur robotin aktual apo RLS-në ekzistuese.
ALTER TABLE public.mmti_state
  ADD COLUMN IF NOT EXISTS optimized_params jsonb,
  ADD COLUMN IF NOT EXISTS optimized_at timestamptz;
