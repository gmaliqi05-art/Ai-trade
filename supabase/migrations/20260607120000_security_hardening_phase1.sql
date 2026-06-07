-- ============================================================
-- SECURITY HARDENING (Faza 1) — vetëm RLS/trigger/view.
-- NUK prek motorin, robotin, auto-trade, apo ndonjë edge function.
-- ============================================================

-- (1) ai_providers: ndalo user-at normalë të lexojnë çelësat API (plaintext).
--     Admini lexon përmes "Admins can manage AI providers"; motori përmes service_role.
DROP POLICY IF EXISTS "Authenticated users can read active providers" ON public.ai_providers;
-- View pa kolona sekrete — për kontrollin "a ka AI aktiv" te Paneli.
DROP VIEW IF EXISTS public.ai_providers_public;
CREATE VIEW public.ai_providers_public AS
  SELECT id, name, slug, model, is_active, is_default, priority
  FROM public.ai_providers WHERE is_active = true;
GRANT SELECT ON public.ai_providers_public TO authenticated;

-- (2) profiles: blloko vetë-ngritjen e is_admin/balance/subscription_tier.
--     Lejon: adminët (UI), service_role/cron (auth.uid() IS NULL); bllokon vetëm user-in normal.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin
      OR NEW.balance IS DISTINCT FROM OLD.balance
      OR NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier) THEN
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Ndryshimi i fushave të privilegjuara (is_admin/balance/subscription_tier) nuk lejohet.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_profile_privileged ON public.profiles;
CREATE TRIGGER trg_guard_profile_privileged
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_fields();

-- (3) signals: vetëm own ose admin mund të fusin (jo user_id NULL nga user normal → s'injektohen sinjale "zyrtare").
DROP POLICY IF EXISTS "Authenticated users can insert own signals" ON public.signals;
CREATE POLICY "Authenticated users can insert own signals" ON public.signals
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- (4) subscriptions: hiq self-update/insert (klienti s'i përdor; shkrim vetëm service-role/webhook).
DROP POLICY IF EXISTS "Users can update own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can insert own subscription" ON public.subscriptions;
