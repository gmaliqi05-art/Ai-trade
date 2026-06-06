/*
  # Forcim sigurie (sipas Supabase advisors)

  1. Funksionet trigger (auto_confirm_user, handle_new_user) nuk duhen si RPC publik →
     hiqi EXECUTE nga PUBLIC/anon/authenticated (trigger-i vazhdon të punojë normalisht).
  2. RPC admin (get_admin_stats, get_all_profiles) → vetëm përdorues të kyçur
     (kontrolli is_admin bëhet brenda funksionit).
  3. Politikat e UPDATE të admin-it për `assets`/`signals` të mos kenë USING(true).

  Idempotent: i sigurt për t'u riaplikuar.
*/

REVOKE EXECUTE ON FUNCTION public.auto_confirm_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()   FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_admin_stats()  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_stats()  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_all_profiles() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_all_profiles() TO authenticated;

DROP POLICY IF EXISTS "Admins can update assets" ON public.assets;
CREATE POLICY "Admins can update assets" ON public.assets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin));

DROP POLICY IF EXISTS "Admins can update signals" ON public.signals;
CREATE POLICY "Admins can update signals" ON public.signals FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin));
