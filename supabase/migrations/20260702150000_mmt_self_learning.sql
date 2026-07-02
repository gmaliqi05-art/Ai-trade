-- MMT L5 — MËSIMI NGA VETVETJA: çdo 24h analizon trade-t e veta të mbyllura dhe
-- rregullon parametrat e vet BRENDA kufijve të sigurt. Çdo ndryshim regjistrohet.
ALTER TABLE public.mmt_config
  ADD COLUMN IF NOT EXISTS learn_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS learn_min_trades integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS last_learned_at timestamptz;

CREATE TABLE IF NOT EXISTS public.mmt_learning (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  learned_at timestamptz NOT NULL DEFAULT now(),
  param text NOT NULL,
  old_value text,
  new_value text,
  reason text,
  sample_n integer,
  expectancy numeric
);
CREATE INDEX IF NOT EXISTS mmt_learning_time_idx ON public.mmt_learning(learned_at DESC);
ALTER TABLE public.mmt_learning ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mmt_learning' AND policyname='mmt_learning_auth_read') THEN
    CREATE POLICY mmt_learning_auth_read ON public.mmt_learning FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
