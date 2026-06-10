-- Per-user MMTI (new super-robot) preferences. Shadow/learning only — does not place orders.
CREATE TABLE IF NOT EXISTS public.mmti_config (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT false,
  capital_preset text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mmti_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mmti_config_own ON public.mmti_config;
CREATE POLICY mmti_config_own ON public.mmti_config FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
