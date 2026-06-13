-- Security hardening: remove the `anon` (not-signed-in) attack surface from admin RPCs.
--
-- Postgres grants EXECUTE to PUBLIC by default, so the `anon` role inherited the ability
-- to call these SECURITY DEFINER functions via /rest/v1/rpc. They already enforce is_admin
-- internally (auth.uid() + is_admin), so this changes NO real behavior — it only stops
-- unauthenticated callers from invoking them at all (defense in depth).
--
-- `authenticated` keeps EXECUTE: the admin UI calls get_all_profiles / admin_set_demo_balance
-- as a signed-in admin, and the internal check still gates non-admins.
-- The trading robot and AI functions run with the service_role (kept), so they are unaffected.

REVOKE EXECUTE ON FUNCTION public.admin_set_demo_balance(uuid, numeric, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_demo_balance(uuid, numeric, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_all_profiles() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_all_profiles() TO authenticated, service_role;

-- Trigger function: fires via the table trigger regardless of EXECUTE grants,
-- so it needs no direct REST-callable EXECUTE for anyone.
REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_fields() FROM PUBLIC;
