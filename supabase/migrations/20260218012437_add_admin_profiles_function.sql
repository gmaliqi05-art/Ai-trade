/*
  # Add security definer function for admin to read all profiles

  Admins need to read all user profiles for User Management.
  Instead of a recursive RLS policy, we use a SECURITY DEFINER function
  that bypasses RLS safely.
*/

CREATE OR REPLACE FUNCTION get_all_profiles()
RETURNS SETOF profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM profiles
  WHERE EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.is_admin = true
  )
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_all_profiles() TO authenticated;
