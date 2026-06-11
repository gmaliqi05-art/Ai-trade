-- DHOMA E EKSPERTËVE — analiza me ekspertë AI (Claude) e çdo 10 trade-ve auto që prekën TP/SL.
-- Vetëm KËSHILLUESE: ruan ekspertizat; nuk prek robotin aktual.
CREATE TABLE IF NOT EXISTS public.expert_room_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_no    integer NOT NULL,
  trades_count integer NOT NULL,
  win_rate    numeric,
  from_time   timestamptz,
  to_time     timestamptz,
  payload     jsonb,            -- {experts:[...], consensus, recommendations:[...], caution, stats}
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expert_room_analyses_created_idx ON public.expert_room_analyses(created_at DESC);

ALTER TABLE public.expert_room_analyses ENABLE ROW LEVEL SECURITY;
-- Vetëm super-admin lexon; shkrimi bëhet nga edge function me service-role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='expert_room_analyses' AND policyname='expert_room_admin_read') THEN
    CREATE POLICY expert_room_admin_read ON public.expert_room_analyses FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));
  END IF;
END $$;
