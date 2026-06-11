-- DHOMA E EKSPERTËVE v2 — "korporata": profile ekspertësh elitarë (doktrina nga dija publike,
-- hulumtuar me Claude) + Super Informatori (sinteza e dijes). Vetëm këshilluese.
CREATE TABLE IF NOT EXISTS public.expert_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,            -- emri i metodologjisë + frymëzimi publik
  methodology text,                     -- përshkrim i shkurtër
  icon        text DEFAULT 'brain',
  doctrine    jsonb,                    -- {principles[],rules[],entry_models[],risk[],note} nga hulumtimi
  researched_at timestamptz,
  created_at  timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.expert_knowledge (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL DEFAULT 'synthesis',   -- synthesis = Super Informatori
  payload    jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expert_knowledge_created_idx ON public.expert_knowledge(created_at DESC);

ALTER TABLE public.expert_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expert_knowledge ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='expert_profiles' AND policyname='expert_profiles_admin_read') THEN
    CREATE POLICY expert_profiles_admin_read ON public.expert_profiles FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='expert_knowledge' AND policyname='expert_knowledge_admin_read') THEN
    CREATE POLICY expert_knowledge_admin_read ON public.expert_knowledge FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));
  END IF;
END $$;

-- 6 anëtarët e dhomës: metodologji elitare me dije PUBLIKE të dokumentuar gjerësisht.
INSERT INTO public.expert_profiles (slug, name, methodology, icon) VALUES
  ('trend',   'Trend Following (frymëzuar nga Turtles / R. Dennis)', 'Sisteme rregullash trend-following, piramidim e dalje të disiplinuara', 'trending-up'),
  ('price',   'Price Action (frymëzuar nga Al Brooks)',              'Lexim bar-pas-bari: kontekst, pullback-e, range vs trend', 'candlestick'),
  ('risk',    'Risk & Psikologji (frymëzuar nga Van Tharp)',         'R-multiples, madhësia e pozicionit, expectancy, disiplina', 'shield'),
  ('wyckoff', 'Metoda Wyckoff',                                      'Akumulim/distribuim, faza tregu, ligji kërkesë-ofertë', 'layers'),
  ('liquidity','Likuiditeti & Sesionet (koncepte publike SMC/ICT)',  'Zona likuiditeti, kohët e sesioneve, sweep-et e niveleve', 'droplets'),
  ('quant',   'Quant / Statistikë sistematike',                      'Validim statistikor, mostra, mbi-përshtatja, robustësia', 'sigma')
ON CONFLICT (slug) DO NOTHING;

-- Çelësi ON/OFF i auto-trade të dhomës (SKELET: asnjë motor s'e lexon ende — s'tregton).
INSERT INTO public.app_config (key, value) VALUES ('expert_autotrade_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
