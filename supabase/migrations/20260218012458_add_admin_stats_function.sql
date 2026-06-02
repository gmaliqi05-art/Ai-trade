/*
  # Add admin stats function

  Security definer function to get platform stats for admin overview.
  Returns user counts, tier breakdown without triggering RLS recursion.
*/

CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'totalUsers', (SELECT COUNT(*) FROM profiles),
    'proUsers', (SELECT COUNT(*) FROM profiles WHERE subscription_tier != 'free'),
    'freeUsers', (SELECT COUNT(*) FROM profiles WHERE subscription_tier = 'free')
  )
  WHERE EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true
  );
$$;

GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated;
