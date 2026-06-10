-- MMTI super-robot state (separate from the live trading robot). Phase A: identity + activation.
CREATE TABLE IF NOT EXISTS public.mmti_state (
  id smallint PRIMARY KEY DEFAULT 1, active boolean NOT NULL DEFAULT false,
  phase text NOT NULL DEFAULT 'learning', trades_learned int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT mmti_single_row CHECK (id = 1)
);
INSERT INTO public.mmti_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.mmti_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mmti_admin_all ON public.mmti_state;
CREATE POLICY mmti_admin_all ON public.mmti_state FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));
